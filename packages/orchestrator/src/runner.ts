import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DebateConfig,
	DebateDirector,
	type DebateState,
	type DirectorAction,
	type JudgeVerdict,
	type ReportMeta,
	type TerminationReason,
	buildDraftReport,
	buildIncrementalPrompt,
	buildInitialPrompt,
	buildJudgeIncrementalPrompt,
	buildJudgeInitialPrompt,
	draftToAuditReport,
	generateSummary,
	renderActionPlanHtml,
	renderActionPlanMarkdown,
} from "@crossfire/orchestrator-core";
import {
	type MarkdownReportMeta,
	buildFullTextSynthesisPrompt,
	renderMarkdownToHtml,
} from "@crossfire/orchestrator-core";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { DebateEventBus } from "./event-bus.js";
import { runFinalSynthesis } from "./final-synthesis.js";
import { runJudgeTurn } from "./judge.js";
import { PlanAccumulator } from "./plan-accumulator.js";

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

export async function runDebate(
	config: DebateConfig,
	adapters: AdapterMap,
	options?: RunDebateOptions,
): Promise<DebateState> {
	const bus = options?.bus ?? new DebateEventBus();
	const isResume = !!options?.resumeFromState;
	const startRound = isResume ? options!.resumeFromState!.currentRound + 1 : 1;

	const unsubs = [
		adapters.proposer.adapter.onEvent((e) => bus.push(e)),
		adapters.challenger.adapter.onEvent((e) => bus.push(e)),
	];
	if (adapters.judge) {
		unsubs.push(adapters.judge.adapter.onEvent((e) => bus.push(e)));
	}

	// PlanAccumulator — accumulates evolving plan from debate events (local-only)
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
	const judgeInjectUnsub = bus.subscribe((event: AnyEvent) => {
		if (
			event.kind === "user.inject" &&
			"target" in event &&
			(event as { target: string }).target === "judge"
		) {
			pendingUserJudge = (event as { text: string }).text;
		}
	});
	unsubs.push(judgeInjectUnsub);

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
				const opponentText =
					proposerState.turns.filter((t) => t.role === "challenger").at(-1)
						?.content ?? "";
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
			// Clear judge text after proposer consumes it
			lastJudgeText = undefined;
			const proposerTurnId = `p-${round}`;
			await adapters.proposer.adapter.sendTurn(adapters.proposer.session, {
				turnId: proposerTurnId,
				prompt: proposerPrompt,
			});
			const proposerResult = await waitForTurnCompleted(bus, proposerTurnId);
			if (proposerResult === "interrupted") return bus.snapshot();

			// Check if proposer produced debate_meta (for schema refresh tracking)
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
				// Challenger Turn 1: include proposer's text as context in initial prompt
				const proposerText =
					challengerState.turns.filter((t) => t.role === "proposer").at(-1)
						?.content ?? "";
				challengerPrompt = buildInitialPrompt({
					role: "challenger",
					topic: config.topic,
					maxRounds: config.maxRounds,
					systemPrompt: config.challengerSystemPrompt,
					schemaType: "debate_meta",
					operationalPreamble: `Proposer's opening response:\n\n${proposerText}`,
				});
			} else {
				const opponentText =
					challengerState.turns.filter((t) => t.role === "proposer").at(-1)
						?.content ?? "";
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
			// Clear judge text after challenger consumes it
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

			// Check if challenger produced debate_meta (for schema refresh tracking)
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
				// All other reasons (scheduled, agent-request): skip and continue
			}

			if (action.type === "trigger-judge" && adapters.judge) {
				director.recordJudgeIntervention();
				bus.push({
					kind: "judge.started",
					roundNumber: round,
					timestamp: Date.now(),
				});
				judgeTurnCount++;
				const judgeState = bus.snapshot();
				const proposerText =
					judgeState.turns.filter((t) => t.role === "proposer").at(-1)
						?.content ?? "";
				const challengerText =
					judgeState.turns.filter((t) => t.role === "challenger").at(-1)
						?.content ?? "";
				let judgePrompt: string;
				if (judgeTurnCount === 1) {
					judgePrompt = buildJudgeInitialPrompt({
						topic: config.topic,
						maxRounds: config.maxRounds,
						roundNumber: round,
						proposerText,
						challengerText,
						systemPrompt: config.judgeSystemPrompt,
					});
				} else {
					judgePrompt = buildJudgeIncrementalPrompt({
						roundNumber: round,
						maxRounds: config.maxRounds,
						proposerText,
						challengerText,
						schemaRefreshMode: getSchemaRefreshMode(
							judgeTurnCount,
							config.judgeEveryNRounds,
							0, // Judge failures not tracked separately
						),
					});
				}
				const verdict = await runJudgeTurn(
					adapters.judge.adapter,
					adapters.judge.session,
					bus,
					{
						turnId: `j-${round}`,
						prompt: judgePrompt,
						roundNumber: round,
					},
				);
				bus.push({
					kind: "judge.completed",
					roundNumber: round,
					verdict,
					timestamp: Date.now(),
				});
				if (verdict) {
					lastJudgeVerdict = verdict;
					lastJudgeText = verdict.reasoning;
				}
				if (verdict && !verdict.shouldContinue) {
					action = { type: "end-debate", reason: "judge-decision" };
					break;
				}
				// Judge overrides stagnation — reset counter so debate can continue
				if (verdict?.shouldContinue) {
					director.resetStagnation();
				}
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
				director.recordJudgeIntervention();
				bus.push({
					kind: "judge.started",
					roundNumber: round,
					timestamp: Date.now(),
				});
				judgeTurnCount++;
				const judgeState = bus.snapshot();
				const proposerText =
					judgeState.turns.filter((t) => t.role === "proposer").at(-1)
						?.content ?? "";
				const challengerText =
					judgeState.turns.filter((t) => t.role === "challenger").at(-1)
						?.content ?? "";
				let judgePrompt: string;
				if (judgeTurnCount === 1) {
					judgePrompt = `${buildJudgeInitialPrompt({
						topic: config.topic,
						maxRounds: config.maxRounds,
						roundNumber: round,
						proposerText,
						challengerText,
						systemPrompt: config.judgeSystemPrompt,
					})}\n\n## User Instruction\n${userInstruction}`;
				} else {
					judgePrompt = `${buildJudgeIncrementalPrompt({
						roundNumber: round,
						maxRounds: config.maxRounds,
						proposerText,
						challengerText,
						schemaRefreshMode: "full",
					})}\n\n## User Instruction\n${userInstruction}`;
				}
				const verdict = await runJudgeTurn(
					adapters.judge.adapter,
					adapters.judge.session,
					bus,
					{
						turnId: `j-user-${round}`,
						prompt: judgePrompt,
						roundNumber: round,
					},
				);
				bus.push({
					kind: "judge.completed",
					roundNumber: round,
					verdict,
					timestamp: Date.now(),
				});
				if (verdict) {
					lastJudgeVerdict = verdict;
					lastJudgeText = verdict.reasoning;
				}
				if (verdict && !verdict.shouldContinue) {
					action = { type: "end-debate", reason: "judge-decision" };
					break;
				}
				if (verdict?.shouldContinue) {
					director.resetStagnation();
				}
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
				bus.push({
					kind: "judge.started",
					roundNumber: finalState.currentRound,
					timestamp: Date.now(),
				});
				judgeTurnCount++;
				const proposerText =
					finalState.turns.filter((t) => t.role === "proposer").at(-1)
						?.content ?? "";
				const challengerText =
					finalState.turns.filter((t) => t.role === "challenger").at(-1)
						?.content ?? "";
				let judgePrompt: string;
				if (judgeTurnCount === 1) {
					judgePrompt = buildJudgeInitialPrompt({
						topic: config.topic,
						maxRounds: config.maxRounds,
						roundNumber: finalState.currentRound,
						proposerText,
						challengerText,
						systemPrompt: config.judgeSystemPrompt,
					});
				} else {
					judgePrompt = buildJudgeIncrementalPrompt({
						roundNumber: finalState.currentRound,
						maxRounds: config.maxRounds,
						proposerText,
						challengerText,
						schemaRefreshMode: "full",
					});
				}
				finalVerdict = await Promise.race([
					runJudgeTurn(adapters.judge.adapter, adapters.judge.session, bus, {
						turnId: "j-final",
						prompt: judgePrompt,
						roundNumber: finalState.currentRound,
					}),
					new Promise<undefined>((resolve) =>
						setTimeout(() => resolve(undefined), 30_000),
					),
				]);
				bus.push({
					kind: "judge.completed",
					roundNumber: finalState.currentRound,
					verdict: finalVerdict,
					timestamp: Date.now(),
				});
			} catch {
				/* Judge failure is non-fatal */
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
						const prompt = buildFullTextSynthesisPrompt(
							preCompleteState,
							plan.judgeNotes,
							{ contextTokenLimit: 128_000 },
							plan.roundSummaries,
						);
						markdownResult = await runFinalSynthesis(
							synthesisAdapter,
							prompt,
							180_000,
						);
					} catch {
						/* non-fatal */
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
					const report = draftToAuditReport(draft);
					const totalItems =
						draft.consensus.length +
						draft.unresolved.length +
						draft.argumentTrajectories.length;
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
			} catch {
				/* non-fatal */
			}

			// transcript.html is written by TranscriptWriter.close()
		}

		bus.push({
			kind: "synthesis.completed",
			quality: synthesisQuality,
			timestamp: Date.now(),
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
