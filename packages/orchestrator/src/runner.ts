import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";
import {
	type AnyEvent,
	DEFAULT_DIRECTOR_CONFIG,
	type DebateConfig,
	DebateDirector,
	type DebateState,
	type DirectorAction,
	type JudgeVerdict,
	type MarkdownReportMeta,
	type ReportMeta,
	type SynthesisAuditSummary,
	type SynthesisDebugMetadata,
	type TerminationReason,
	assembleAdaptiveSynthesisPrompt,
	buildDraftReport,
	buildIncrementalPrompt,
	buildInitialPrompt,
	buildInstructions,
	buildJudgeIncrementalPrompt,
	buildJudgeInitialPrompt,
	computeReferenceScores,
	draftToAuditReport,
	generateSummary,
	renderActionPlanHtml,
	renderActionPlanMarkdown,
	renderMarkdownToHtml,
} from "@crossfire/orchestrator-core";
import { DebateEventBus } from "./event-bus.js";
import {
	type SynthesisRunResult,
	runFinalSynthesis,
} from "./final-synthesis.js";
import { runJudgeTurn } from "./judge.js";
import { PlanAccumulator } from "./plan-accumulator.js";
import type { TranscriptWriter } from "./transcript-writer.js";

export interface AdapterMap {
	proposer: { adapter: AgentAdapter; session: SessionHandle };
	challenger: { adapter: AgentAdapter; session: SessionHandle };
	judge?: { adapter: AgentAdapter; session: SessionHandle };
}

export interface RunDebateOptions {
	outputDir?: string;
	bus?: DebateEventBus;
	resumeFromState?: DebateState;
	debateId?: string;
	transcriptWriter?: TranscriptWriter;
}

/**
 * Determine schema refresh mode for incremental prompts.
 * Returns "full" on Turn 1, after parse failures, or on cadence-aligned rounds.
 * Returns "reminder" otherwise.
 */
export function getSchemaRefreshMode(
	turnCount: number,
	judgeEveryN: number,
	consecutiveFailures: number,
): "full" | "reminder" {
	if (turnCount <= 1) return "full";
	if (consecutiveFailures >= 1) return "full";
	if (judgeEveryN > 0 && turnCount % judgeEveryN === 0) return "full";
	return "reminder";
}

function appendOperationalGuidance(prompt: string, guidance?: string): string {
	if (!guidance) return prompt;
	return `${prompt}\n\n[ADDITIONAL GUIDANCE]\n${guidance}`;
}

export async function runDebate(
	config: DebateConfig,
	adapters: AdapterMap,
	options?: RunDebateOptions,
): Promise<DebateState> {
	const bus = options?.bus ?? new DebateEventBus();
	const resumeState = options?.resumeFromState;
	const isResume = resumeState !== undefined;
	const startRound = resumeState ? resumeState.currentRound + 1 : 1;

	// Populate recovery context on each session so adapters can rebuild from transcript
	populateRecoveryContext(adapters, config);

	const unsubs = [
		adapters.proposer.adapter.onEvent((e) => bus.push(e)),
		adapters.challenger.adapter.onEvent((e) => bus.push(e)),
	];
	if (adapters.judge) {
		unsubs.push(adapters.judge.adapter.onEvent((e) => bus.push(e)));
	}

	const synthesisEnabled = process.env.CROSSFIRE_SYNTHESIZER !== "0";
	const accumulator = new PlanAccumulator();
	const accUnsub = accumulator.subscribe(bus);

	if (!isResume) {
		bus.push({
			kind: "debate.started",
			debateId: options?.debateId,
			config,
			roles: {
				proposer: {
					agentType: adapters.proposer.adapter.id,
					model: config.proposerModel,
				},
				challenger: {
					agentType: adapters.challenger.adapter.id,
					model: config.challengerModel,
				},
				...(adapters.judge
					? {
							judge: {
								agentType: adapters.judge.adapter.id,
								model: config.judgeModel,
							},
						}
					: {}),
			},
			timestamp: Date.now(),
		});
	} else {
		bus.push({
			kind: "debate.resumed",
			fromRound: startRound,
			timestamp: Date.now(),
		});
	}

	const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
	let action: DirectorAction = { type: "continue" };
	let lastJudgeVerdict: JudgeVerdict | undefined;

	// Incremental prompt tracking
	let proposerTurnCount = 0;
	let challengerTurnCount = 0;
	let judgeTurnCount = 0;
	let lastJudgeText: string | undefined;
	let proposerConsecutiveFailures = 0;
	let challengerConsecutiveFailures = 0;

	// Track pending user-triggered judge requests via bus events
	let pendingUserJudge: string | undefined;
	const userInjectUnsub = bus.subscribe((event: AnyEvent) => {
		if (event.kind === "user.inject" && "target" in event) {
			const inject = event as {
				target: "proposer" | "challenger" | "both" | "judge";
				text: string;
				priority: "normal" | "high";
			};
			if (inject.target === "judge") {
				pendingUserJudge = inject.text;
				return;
			}
			const targets =
				inject.target === "both"
					? (["proposer", "challenger"] as const)
					: [inject.target];
			for (const target of targets) {
				director.storeGuidance(target, inject.text, inject.priority, "user");
			}
		}
	});
	unsubs.push(userInjectUnsub);

	/**
	 * Build judge prompt based on turn count, using initial or incremental builder.
	 * Appends optional suffix (e.g. user instruction).
	 */
	function buildJudgePrompt(
		roundNumber: number,
		proposerText: string,
		challengerText: string,
		schemaRefreshOverride?: "full" | "reminder",
		suffix?: string,
	): string {
		let prompt: string;
		if (judgeTurnCount === 1) {
			prompt = buildJudgeInitialPrompt({
				topic: config.topic,
				maxRounds: config.maxRounds,
				roundNumber,
				proposerText,
				challengerText,
				systemPrompt: config.judgeSystemPrompt,
			});
		} else {
			prompt = buildJudgeIncrementalPrompt({
				roundNumber,
				maxRounds: config.maxRounds,
				proposerText,
				challengerText,
				schemaRefreshMode:
					schemaRefreshOverride ??
					getSchemaRefreshMode(
						judgeTurnCount,
						config.judgeEveryNRounds,
						0, // Judge failures not tracked separately
					),
			});
		}
		if (suffix) {
			prompt = `${prompt}\n\n${suffix}`;
		}
		return prompt;
	}

	/**
	 * Execute a full judge invocation: emit started, build prompt, run turn,
	 * emit completed, and return the verdict.
	 */
	async function invokeJudge(
		turnId: string,
		roundNumber: number,
		schemaRefreshOverride?: "full" | "reminder",
		promptSuffix?: string,
	): Promise<JudgeVerdict | undefined> {
		if (!adapters.judge) return undefined;
		director.recordJudgeIntervention();
		bus.push({
			kind: "judge.started",
			roundNumber,
			timestamp: Date.now(),
		});
		judgeTurnCount++;
		const state = bus.snapshot();
		const proposerText = getLatestTurnContent(state, "proposer");
		const challengerText = getLatestTurnContent(state, "challenger");
		const prompt = buildJudgePrompt(
			roundNumber,
			proposerText,
			challengerText,
			schemaRefreshOverride,
			promptSuffix,
		);
		const verdict = await runJudgeTurn(
			adapters.judge.adapter,
			adapters.judge.session,
			bus,
			{ turnId, prompt, roundNumber },
		);
		bus.push({
			kind: "judge.completed",
			roundNumber,
			verdict,
			timestamp: Date.now(),
		});
		return verdict;
	}

	/**
	 * Process verdict result: update tracking state and determine if debate should end.
	 * Returns true if the judge decided to end the debate.
	 */
	function handleJudgeVerdict(verdict: JudgeVerdict | undefined): boolean {
		if (verdict) {
			lastJudgeVerdict = verdict;
			lastJudgeText = verdict.reasoning;
		}
		if (verdict && !verdict.shouldContinue) {
			action = { type: "end-debate", reason: "judge-decision" };
			return true;
		}
		if (verdict?.shouldContinue) {
			director.resetStagnation();
		}
		return false;
	}

	try {
		for (let round = startRound; round <= config.maxRounds; round++) {
			// Proposer turn
			bus.push({
				kind: "round.started",
				roundNumber: round,
				speaker: "proposer",
				timestamp: Date.now(),
			});
			proposerTurnCount++;
			const proposerState = bus.snapshot();
			let proposerPrompt: string;
			if (proposerTurnCount === 1) {
				proposerPrompt = buildInitialPrompt({
					role: "proposer",
					topic: config.topic,
					maxRounds: config.maxRounds,
					systemPrompt: config.proposerSystemPrompt,
					schemaType: "debate_meta",
				});
			} else {
				const opponentText = getLatestTurnContent(proposerState, "challenger");
				proposerPrompt = buildIncrementalPrompt({
					roundNumber: round,
					maxRounds: config.maxRounds,
					opponentRole: "challenger",
					opponentText,
					judgeText: lastJudgeText,
					schemaRefreshMode: getSchemaRefreshMode(
						proposerTurnCount,
						config.judgeEveryNRounds,
						proposerConsecutiveFailures,
					),
				});
			}
			proposerPrompt = appendOperationalGuidance(
				proposerPrompt,
				director.getGuidance("proposer"),
			);
			lastJudgeText = undefined;
			const proposerTurnId = `p-${round}`;
			await adapters.proposer.adapter.sendTurn(adapters.proposer.session, {
				turnId: proposerTurnId,
				prompt: proposerPrompt,
			});
			const proposerResult = await waitForTurnCompleted(bus, proposerTurnId);
			if (proposerResult === "interrupted") return bus.snapshot();

			// Track schema refresh failures
			const stateAfterProposer = bus.snapshot();
			const lastProposerTurn = stateAfterProposer.turns
				.filter((t) => t.role === "proposer")
				.at(-1);
			if (lastProposerTurn?.meta) {
				proposerConsecutiveFailures = 0;
			} else {
				proposerConsecutiveFailures++;
			}

			bus.push({
				kind: "round.completed",
				roundNumber: round,
				speaker: "proposer",
				timestamp: Date.now(),
			});

			// Challenger turn
			bus.push({
				kind: "round.started",
				roundNumber: round,
				speaker: "challenger",
				timestamp: Date.now(),
			});
			challengerTurnCount++;
			const challengerState = bus.snapshot();
			let challengerPrompt: string;
			if (challengerTurnCount === 1) {
				const proposerText = getLatestTurnContent(challengerState, "proposer");
				challengerPrompt = buildInitialPrompt({
					role: "challenger",
					topic: config.topic,
					maxRounds: config.maxRounds,
					systemPrompt: config.challengerSystemPrompt,
					schemaType: "debate_meta",
					operationalPreamble: `Proposer's opening response:\n\n${proposerText}`,
				});
			} else {
				const opponentText = getLatestTurnContent(challengerState, "proposer");
				challengerPrompt = buildIncrementalPrompt({
					roundNumber: round,
					maxRounds: config.maxRounds,
					opponentRole: "proposer",
					opponentText,
					judgeText: lastJudgeText,
					schemaRefreshMode: getSchemaRefreshMode(
						challengerTurnCount,
						config.judgeEveryNRounds,
						challengerConsecutiveFailures,
					),
				});
			}
			challengerPrompt = appendOperationalGuidance(
				challengerPrompt,
				director.getGuidance("challenger"),
			);
			lastJudgeText = undefined;
			const challengerTurnId = `c-${round}`;
			await adapters.challenger.adapter.sendTurn(adapters.challenger.session, {
				turnId: challengerTurnId,
				prompt: challengerPrompt,
			});
			const challengerResult = await waitForTurnCompleted(
				bus,
				challengerTurnId,
			);
			if (challengerResult === "interrupted") return bus.snapshot();

			// Track schema refresh failures
			const stateAfterChallenger = bus.snapshot();
			const lastChallengerTurn = stateAfterChallenger.turns
				.filter((t) => t.role === "challenger")
				.at(-1);
			if (lastChallengerTurn?.meta) {
				challengerConsecutiveFailures = 0;
			} else {
				challengerConsecutiveFailures++;
			}

			bus.push({
				kind: "round.completed",
				roundNumber: round,
				speaker: "challenger",
				timestamp: Date.now(),
			});

			// Director evaluation after each round
			const stateAfterRound = bus.snapshot();
			action = director.evaluate(stateAfterRound);
			bus.push({
				kind: "director.action",
				action,
				signals: director.lastSignals(),
				timestamp: Date.now(),
			});

			if (action.type === "end-debate") break;

			// No judge available — handle trigger-judge actions locally
			if (action.type === "trigger-judge" && !adapters.judge) {
				if (action.reason === "convergence") {
					action = { type: "end-debate", reason: "convergence" };
					break;
				}
				// Stagnation/degradation without judge: count as if judge intervened
				// but couldn't help, so Director's stagnation-limit can eventually fire
				if (action.reason === "stagnation" || action.reason === "degradation") {
					director.recordJudgeIntervention();
				}
			}

			if (action.type === "trigger-judge" && adapters.judge) {
				const verdict = await invokeJudge(`j-${round}`, round);
				if (handleJudgeVerdict(verdict)) break;
			}

			if (action.type === "inject-guidance") {
				director.storeGuidance(
					action.target,
					action.text,
					"normal",
					action.source,
				);
			}

			// Check for user-triggered judge request (via /inject judge)
			if (pendingUserJudge !== undefined && adapters.judge) {
				const userInstruction = pendingUserJudge;
				pendingUserJudge = undefined;
				const verdict = await invokeJudge(
					`j-user-${round}`,
					round,
					"full",
					`## User Instruction\n${userInstruction}`,
				);
				if (handleJudgeVerdict(verdict)) break;
			}
		}

		// Final outcome flow
		const terminationReason: TerminationReason =
			action.type === "end-debate" ? action.reason : "max-rounds";

		// Final-review judge if available (skip if mid-round judge already ended the debate)
		let finalVerdict: JudgeVerdict | undefined;
		const alreadyJudged =
			action.type === "end-debate" && action.reason === "judge-decision";
		if (adapters.judge && !alreadyJudged) {
			try {
				const finalState = bus.snapshot();
				finalVerdict = await Promise.race([
					invokeJudge("j-final", finalState.currentRound, "full"),
					new Promise<undefined>((resolve) =>
						setTimeout(() => resolve(undefined), 30_000),
					),
				]);
			} catch (err) {
				bus.push({
					kind: "synthesis.error",
					phase: "judge-final",
					message: err instanceof Error ? err.message : String(err),
					timestamp: Date.now(),
				});
			}
		}

		// Signal TUI that synthesis is starting
		bus.push({
			kind: "synthesis.started",
			timestamp: Date.now(),
		});

		// Generate summary before debate.completed
		const preCompleteState = bus.snapshot();
		const summary = generateSummary(
			preCompleteState,
			finalVerdict ?? lastJudgeVerdict,
			terminationReason,
		);
		let synthesisQuality: "llm-full" | "local-structured" | "local-degraded" =
			"local-degraded";
		let synthesisDebug: SynthesisAuditSummary | undefined;
		let fullDebugMetadata: SynthesisDebugMetadata | undefined;
		let synthRunResult: SynthesisRunResult | undefined;
		let submittedSynthesisPromptCharLength = 0;
		const synthesisStartTime = Date.now();

		if (options?.outputDir) {
			try {
				await accumulator.flush();
				const plan = accumulator.snapshot();
				const draft = buildDraftReport(plan);

				let markdownResult: string | undefined;

				// Primary path: LLM final synthesis (new isolated session)
				if (synthesisEnabled) {
					try {
						const synthesisAdapter =
							adapters.judge?.adapter ?? adapters.proposer.adapter;
						const cleanTranscript =
							options?.transcriptWriter?.getCleanTranscript();
						const referenceScores = computeReferenceScores(
							preCompleteState,
							plan,
						);
						const result = assembleAdaptiveSynthesisPrompt({
							state: preCompleteState,
							plan,
							topic: preCompleteState.config.topic,
							cleanTranscript,
							config: { contextTokenLimit: 128_000 },
							referenceScores:
								referenceScores.size > 0 ? referenceScores : undefined,
						});

						fullDebugMetadata = result.debug;

						synthesisDebug = {
							budgetTier: result.debug.budgetTier,
							totalEstimatedTokens: result.debug.totalEstimatedTokens,
							budgetTokens: result.debug.budgetTokens,
							promptCharLength: 0,
							fullTextRounds: result.debug.fullTextRounds,
							compressedRounds: result.debug.compressedRounds,
							shrinkTrace: result.debug.shrinkTrace,
							fitAchieved: result.debug.fitAchieved,
							durationMs: 0, // updated after LLM call
						};

						const prompt = `${buildInstructions(result.debug.budgetTier)}\n\n${result.prompt}`;
						submittedSynthesisPromptCharLength = prompt.length;
						synthesisDebug.promptCharLength =
							submittedSynthesisPromptCharLength;
						synthRunResult = await runFinalSynthesis(
							synthesisAdapter,
							prompt,
							180_000,
						);

						synthesisDebug.durationMs = synthRunResult.durationMs;

						if (synthRunResult.error) {
							bus.push({
								kind: "synthesis.error",
								phase: "llm-synthesis",
								message: synthRunResult.error,
								timestamp: Date.now(),
							});
						}

						// Only treat as successful LLM output if no error occurred.
						// A timed-out synthesis may have partial text useful for diagnostics,
						// but must not be classified as llm-full.
						if (!synthRunResult.error) {
							markdownResult = synthRunResult.markdown;
						}
					} catch (err) {
						bus.push({
							kind: "synthesis.error",
							phase: "prompt-assembly",
							message: err instanceof Error ? err.message : String(err),
							timestamp: Date.now(),
						});
					}
				}

				const baseMeta = {
					topic: preCompleteState.config.topic,
					roundsCompleted: summary.roundsCompleted,
					date: new Date().toLocaleDateString(),
					participants: {
						proposer: adapters.proposer.adapter.id,
						challenger: adapters.challenger.adapter.id,
						judge: adapters.judge?.adapter.id,
					},
				};

				if (markdownResult) {
					synthesisQuality = "llm-full";
					const meta: MarkdownReportMeta = {
						...baseMeta,
						generationQuality: "llm-full",
					};
					writeFileSync(
						join(options.outputDir, "action-plan.md"),
						`<!-- Generated by Crossfire LLM synthesis -->\n${markdownResult}`,
					);
					writeFileSync(
						join(options.outputDir, "action-plan.html"),
						renderMarkdownToHtml(markdownResult, meta),
					);
				} else {
					// Fallback: improved local template
					const report = draftToAuditReport(draft, summary);
					const totalItems =
						report.consensusItems.length +
						report.unresolvedIssues.length +
						report.argumentEvolution.length;
					synthesisQuality =
						totalItems >= 3 ? "local-structured" : "local-degraded";
					const fallbackMeta: ReportMeta = {
						...baseMeta,
						generationQuality:
							synthesisQuality === "local-structured"
								? "draft-filled"
								: "legacy-fallback",
					};
					writeFileSync(
						join(options.outputDir, "action-plan.html"),
						renderActionPlanHtml(report, fallbackMeta),
					);
					writeFileSync(
						join(options.outputDir, "action-plan.md"),
						renderActionPlanMarkdown(report, fallbackMeta),
					);
				}

				// Write full-fidelity synthesis debug artifact
				try {
					const debugArtifact = {
						synthesisPath: synthesisQuality,
						durationMs: Date.now() - synthesisStartTime,
						promptCharLength: submittedSynthesisPromptCharLength,
						...(fullDebugMetadata ?? {}),
						llmResult: synthRunResult
							? {
									durationMs: synthRunResult.durationMs,
									rawDeltaLength: synthRunResult.rawDeltaLength,
									hadMarkdown: !!synthRunResult.markdown,
									error: synthRunResult.error,
									diagnostics: synthRunResult.diagnostics,
								}
							: undefined,
					};
					writeFileSync(
						join(options.outputDir, "synthesis-debug.json"),
						`${JSON.stringify(debugArtifact, null, 2)}\n`,
					);
				} catch (err) {
					bus.push({
						kind: "synthesis.error",
						phase: "file-write",
						message: `Failed to write synthesis-debug.json: ${err instanceof Error ? err.message : String(err)}`,
						timestamp: Date.now(),
					});
				}
			} catch (err) {
				bus.push({
					kind: "synthesis.error",
					phase: "file-write",
					message: err instanceof Error ? err.message : String(err),
					timestamp: Date.now(),
				});
			}

			// transcript.html is written by TranscriptWriter.close()
		}

		bus.push({
			kind: "synthesis.completed",
			quality: synthesisQuality,
			timestamp: Date.now(),
			debug: synthesisDebug
				? { ...synthesisDebug, durationMs: Date.now() - synthesisStartTime }
				: undefined,
		});

		// Push debate.completed LAST
		bus.push({
			kind: "debate.completed",
			reason: terminationReason,
			summary,
			outputDir: options?.outputDir,
			timestamp: Date.now(),
		});
		return bus.snapshot();
	} finally {
		accUnsub();
		for (const unsub of unsubs) unsub();
	}
}

function getLatestTurnContent(state: DebateState, role: string): string {
	return state.turns.filter((t) => t.role === role).at(-1)?.content ?? "";
}

function populateRecoveryContext(
	adapters: AdapterMap,
	config: DebateConfig,
): void {
	const roles = [
		{
			entry: adapters.proposer,
			role: "proposer",
			systemPrompt: config.proposerSystemPrompt,
			schemaType: "debate_meta",
		},
		{
			entry: adapters.challenger,
			role: "challenger",
			systemPrompt: config.challengerSystemPrompt,
			schemaType: "debate_meta",
		},
	] as const;

	for (const { entry, role, systemPrompt, schemaType } of roles) {
		entry.session.recoveryContext = {
			systemPrompt: systemPrompt ?? "",
			topic: config.topic,
			role,
			maxRounds: config.maxRounds,
			schemaType,
		};
	}

	if (adapters.judge) {
		adapters.judge.session.recoveryContext = {
			systemPrompt: config.judgeSystemPrompt ?? "",
			topic: config.topic,
			role: "judge",
			maxRounds: config.maxRounds,
			schemaType: "judge_verdict",
		};
	}
}

function waitForTurnCompleted(
	bus: DebateEventBus,
	turnId: string,
): Promise<"completed" | "interrupted"> {
	return new Promise((resolve) => {
		const unsub = bus.subscribe((event: AnyEvent) => {
			if (
				event.kind === "turn.completed" &&
				"turnId" in event &&
				(event as NormalizedEvent).turnId === turnId
			) {
				unsub();
				resolve("completed");
			} else if (
				event.kind === "debate.completed" &&
				"reason" in event &&
				(event as { reason: string }).reason === "user-interrupt"
			) {
				unsub();
				resolve("interrupted");
			}
		});
	});
}
