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
	buildJudgePrompt,
	buildTurnPrompt,
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
			const proposerState = bus.snapshot();
			const pGuidance = director.getGuidance("proposer");
			const proposerPrompt = buildTurnPrompt(proposerState, "proposer", {
				guidance: pGuidance,
			});
			bus.push({
				kind: "prompt.stats",
				roundNumber: round,
				speaker: "proposer",
				promptChars: proposerPrompt.length,
				timestamp: Date.now(),
			});
			const proposerTurnId = `p-${round}`;
			await adapters.proposer.adapter.sendTurn(adapters.proposer.session, {
				turnId: proposerTurnId,
				prompt: proposerPrompt,
			});
			const proposerResult = await waitForTurnCompleted(bus, proposerTurnId);
			if (proposerResult === "interrupted") return bus.snapshot();
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
			const challengerState = bus.snapshot();
			const cGuidance = director.getGuidance("challenger");
			const challengerPrompt = buildTurnPrompt(challengerState, "challenger", {
				guidance: cGuidance,
			});
			bus.push({
				kind: "prompt.stats",
				roundNumber: round,
				speaker: "challenger",
				promptChars: challengerPrompt.length,
				timestamp: Date.now(),
			});
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

			// No judge available — convergence must end the debate directly
			if (action.type === "trigger-judge" && !adapters.judge) {
				if (action.reason === "convergence") {
					action = { type: "end-debate", reason: "convergence" };
					break;
				}
			}

			if (action.type === "trigger-judge" && adapters.judge) {
				director.recordJudgeIntervention();
				bus.push({
					kind: "judge.started",
					roundNumber: round,
					timestamp: Date.now(),
				});
				const judgeState = bus.snapshot();
				const judgePrompt = buildJudgePrompt(judgeState);
				bus.push({
					kind: "prompt.stats",
					roundNumber: round,
					speaker: "judge",
					promptChars: judgePrompt.length,
					timestamp: Date.now(),
				});
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
				if (verdict) lastJudgeVerdict = verdict;
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
				const judgeState = bus.snapshot();
				const judgePrompt = `${buildJudgePrompt(judgeState)}\n\n## User Instruction\n${userInstruction}`;
				bus.push({
					kind: "prompt.stats",
					roundNumber: round,
					speaker: "judge",
					promptChars: judgePrompt.length,
					timestamp: Date.now(),
				});
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
				if (verdict) lastJudgeVerdict = verdict;
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
				const judgePrompt = buildJudgePrompt(bus.snapshot());
				bus.push({
					kind: "prompt.stats",
					roundNumber: finalState.currentRound,
					speaker: "judge",
					promptChars: judgePrompt.length,
					timestamp: Date.now(),
				});
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
							bus,
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
