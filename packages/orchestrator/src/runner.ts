import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentAdapter,
	type EvidenceSource,
	type LegacyToolPolicyInput,
	type NormalizedEvent,
	type PolicyClampNote,
	type PolicyPreset,
	type PolicyTranslationSummary,
	type PolicyTranslationWarning,
	type PresetSource,
	type ProviderObservationResult,
	type ResolvedPolicy,
	type SessionHandle,
	compilePolicy,
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
	defaultSystemPrompt,
	draftToAuditReport,
	generateSummary,
	renderActionPlanHtml,
	renderActionPlanMarkdown,
	renderMarkdownToHtml,
} from "@crossfire/orchestrator-core";
import { DebateEventBus } from "./event-bus.js";
import {
	DEFAULT_SYNTHESIS_TIMEOUT_MS,
	type SynthesisRunResult,
	runFinalSynthesis,
} from "./final-synthesis.js";
import { runJudgeTurn } from "./judge.js";
import { PlanAccumulator } from "./plan-accumulator.js";
import type { TranscriptWriter } from "./transcript-writer.js";

export interface AdapterMap {
	proposer: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		baselineClamps?: readonly PolicyClampNote[];
		baselinePreset?: {
			value: PolicyPreset;
			source: PresetSource;
		};
		baselineEvidenceSource?: EvidenceSource;
		baselineTemplateName?: string;
		baselineTemplateBasePreset?: string;
		baselineObservation?: ProviderObservationResult;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
		observePolicy?: (policy: ResolvedPolicy) => ProviderObservationResult;
	};
	challenger: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		baselineClamps?: readonly PolicyClampNote[];
		baselinePreset?: {
			value: PolicyPreset;
			source: PresetSource;
		};
		baselineEvidenceSource?: EvidenceSource;
		baselineTemplateName?: string;
		baselineTemplateBasePreset?: string;
		baselineObservation?: ProviderObservationResult;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
		observePolicy?: (policy: ResolvedPolicy) => ProviderObservationResult;
	};
	judge?: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		baselineClamps?: readonly PolicyClampNote[];
		baselinePreset?: {
			value: PolicyPreset;
			source: PresetSource;
		};
		baselineEvidenceSource?: EvidenceSource;
		baselineTemplateName?: string;
		baselineTemplateBasePreset?: string;
		baselineObservation?: ProviderObservationResult;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
		observePolicy?: (policy: ResolvedPolicy) => ProviderObservationResult;
	};
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

function getEvidenceGuidance(
	role: "proposer" | "challenger" | "judge",
	policy: ResolvedPolicy | undefined,
): string | undefined {
	const bar = policy?.evidence.bar;
	if (!bar) return undefined;

	if (role === "judge") {
		switch (bar) {
			case "low":
				return "Evidence requirement: low. Prefer concrete support when available, but do not over-penalize lightweight exploratory claims.";
			case "medium":
				return "Evidence requirement: medium. Weigh concrete references and tool-verified evidence meaningfully when assessing argument quality.";
			case "high":
				return "Evidence requirement: high. Treat evidence quality as a primary criterion; unsupported claims should count strongly against a side.";
		}
	}

	switch (bar) {
		case "low":
			return "Evidence requirement: low. Prioritize progress, and add concrete references when they materially strengthen a claim.";
		case "medium":
			return "Evidence requirement: medium. Support important claims with concrete references or tool-verified evidence when available.";
		case "high":
			return "Evidence requirement: high. Treat unsupported claims as weak; back significant assertions with concrete references, citations, or tool-verified evidence.";
	}
}

function appendEvidenceGuidance(
	prompt: string,
	role: "proposer" | "challenger" | "judge",
	policy: ResolvedPolicy | undefined,
): string {
	const guidance = getEvidenceGuidance(role, policy);
	if (!guidance) return prompt;
	return `${prompt}\n\n[EVIDENCE POLICY]\n${guidance}`;
}

function resolveRecoverySystemPrompt(
	role: "proposer" | "challenger" | "judge",
	systemPrompt: string | undefined,
	policy: ResolvedPolicy | undefined,
): string {
	const basePrompt = systemPrompt ?? defaultSystemPrompt(role);
	const guidance = getEvidenceGuidance(role, policy);
	return guidance ? `${basePrompt} ${guidance}` : basePrompt;
}

function getObservationForPolicy(
	entry: {
		observePolicy?: (policy: ResolvedPolicy) => ProviderObservationResult;
		baselineObservation?: ProviderObservationResult;
		baselinePolicy?: ResolvedPolicy;
	},
	policy: ResolvedPolicy,
): ProviderObservationResult | undefined {
	if (
		entry.baselineObservation &&
		entry.baselinePolicy &&
		entry.baselinePolicy === policy
	) {
		return entry.baselineObservation;
	}
	return entry.observePolicy?.(policy);
}

function emitBaselinePolicyEvents(
	bus: DebateEventBus,
	adapters: AdapterMap,
): void {
	for (const role of ["proposer", "challenger", "judge"] as const) {
		const entry = adapters[role];
		if (!entry?.baselinePolicy || !entry.baselinePreset) continue;
		const observation = getObservationForPolicy(entry, entry.baselinePolicy);
		const fallbackObservation: ProviderObservationResult = {
			translation: {
				adapter: entry.session.adapterId ?? "unknown",
				nativeSummary: {},
				exactFields: [],
				approximateFields: [],
				unsupportedFields: [],
			},
			toolView: [],
			capabilityEffects: [],
			warnings: [],
			completeness: "minimal",
		};
		bus.push({
			kind: "policy.baseline",
			role,
			policy: entry.baselinePolicy,
			clamps: [...(entry.baselineClamps ?? [])],
			preset: entry.baselinePreset,
			...(entry.baselineEvidenceSource
				? { evidence: { source: entry.baselineEvidenceSource } }
				: {}),
			...(entry.baselineTemplateName
				? {
						template: {
							name: entry.baselineTemplateName,
							basePreset: entry.baselineTemplateBasePreset,
						},
					}
				: {}),
			translationSummary:
				observation?.translation ?? fallbackObservation.translation,
			warnings: [...(observation?.warnings ?? [])],
			observation: observation ?? fallbackObservation,
			timestamp: Date.now(),
		});
	}
}

function createPauseGate(bus: DebateEventBus) {
	let paused = false;
	let waiters: Array<() => void> = [];

	const unsubscribe = bus.subscribe((event: AnyEvent) => {
		if (event.kind === "debate.paused") {
			paused = true;
			return;
		}
		if (
			event.kind === "debate.unpaused" ||
			event.kind === "debate.started" ||
			event.kind === "debate.resumed" ||
			event.kind === "debate.completed"
		) {
			paused = false;
			for (const resolve of waiters) resolve();
			waiters = [];
		}
	});

	return {
		async waitIfPaused(): Promise<void> {
			if (!paused) return;
			await new Promise<void>((resolve) => {
				waiters.push(resolve);
			});
		},
		dispose(): void {
			unsubscribe();
		},
	};
}

interface ActiveTurnContext {
	role: "proposer" | "challenger" | "judge";
	turnId: string;
	adapter: AgentAdapter;
	adapterId: SessionHandle["adapterId"];
	adapterSessionId: string;
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
	const pauseGate = createPauseGate(bus);

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
		emitBaselinePolicyEvents(bus, adapters);
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
	let activeTurn: ActiveTurnContext | undefined;
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

	const interruptUnsub = bus.subscribe((event: AnyEvent) => {
		if (event.kind !== "turn.interrupt.requested") return;
		const requestedTarget = (
			event as {
				target: "current" | "proposer" | "challenger" | "judge";
			}
		).target;
		const effectiveTarget =
			requestedTarget === "current" ? activeTurn?.role : requestedTarget;

		if (!activeTurn || !effectiveTarget) {
			bus.push({
				kind: "run.warning",
				message:
					"Interrupt requested, but there is no active turn to interrupt.",
				timestamp: Date.now(),
				adapterId: adapters.proposer.session.adapterId,
				adapterSessionId: adapters.proposer.session.adapterSessionId,
			});
			return;
		}
		if (activeTurn.role !== effectiveTarget) {
			bus.push({
				kind: "run.warning",
				message: `Interrupt requested for ${effectiveTarget}, but active turn belongs to ${activeTurn.role}.`,
				timestamp: Date.now(),
				adapterId: activeTurn.adapterId,
				adapterSessionId: activeTurn.adapterSessionId,
				turnId: activeTurn.turnId,
			});
			return;
		}
		if (!activeTurn.adapter.interrupt) {
			bus.push({
				kind: "run.warning",
				message: `Adapter ${activeTurn.adapter.id} does not support interrupt for ${activeTurn.role}.`,
				timestamp: Date.now(),
				adapterId: activeTurn.adapterId,
				adapterSessionId: activeTurn.adapterSessionId,
				turnId: activeTurn.turnId,
			});
			return;
		}
		void activeTurn.adapter.interrupt(activeTurn.turnId).catch((error) => {
			bus.push({
				kind: "run.warning",
				message: `Interrupt failed for ${activeTurn?.role ?? effectiveTarget}: ${error instanceof Error ? error.message : String(error)}`,
				timestamp: Date.now(),
				adapterId: activeTurn?.adapterId ?? adapters.proposer.session.adapterId,
				adapterSessionId:
					activeTurn?.adapterSessionId ??
					adapters.proposer.session.adapterSessionId,
				turnId: activeTurn?.turnId,
			});
		});
	});
	unsubs.push(interruptUnsub);

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
				maxRounds: bus.snapshot().config.maxRounds,
				roundNumber,
				proposerText,
				challengerText,
				systemPrompt: config.judgeSystemPrompt,
			});
		} else {
			prompt = buildJudgeIncrementalPrompt({
				roundNumber,
				maxRounds: bus.snapshot().config.maxRounds,
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
		prompt = appendEvidenceGuidance(
			prompt,
			"judge",
			adapters.judge?.baselinePolicy,
		);
		if (suffix) {
			prompt = `${prompt}\n\n${suffix}`;
		}
		return prompt;
	}

	function completeInterruptedDebate(): DebateState {
		bus.push({
			kind: "debate.completed",
			reason: "interrupted",
			timestamp: Date.now(),
		});
		return bus.snapshot();
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
	): Promise<{ verdict?: JudgeVerdict; interrupted: boolean }> {
		if (!adapters.judge) return { interrupted: false };
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
		activeTurn = {
			role: "judge",
			turnId,
			adapter: adapters.judge.adapter,
			adapterId: adapters.judge.session.adapterId,
			adapterSessionId: adapters.judge.session.adapterSessionId,
		};
		const result = await runJudgeTurn(
			adapters.judge.adapter,
			adapters.judge.session,
			bus,
			{
				turnId,
				prompt,
				roundNumber,
				policy: adapters.judge.baselinePolicy,
			},
		);
		activeTurn = undefined;
		if (result.status === "interrupted") {
			return { interrupted: true };
		}
		const verdict = result.verdict;
		bus.push({
			kind: "judge.completed",
			roundNumber,
			verdict,
			timestamp: Date.now(),
		});
		return { verdict, interrupted: false };
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

	interface AgentTurnInput {
		role: "proposer" | "challenger";
		round: number;
		turnCount: number;
		consecutiveFailures: number;
		opponentRole: "proposer" | "challenger";
		systemPrompt?: string;
		adapterEntry: {
			adapter: AgentAdapter;
			session: SessionHandle;
			baselinePolicy?: ResolvedPolicy;
			legacyToolPolicyInput?: LegacyToolPolicyInput;
		};
		operationalPreamble?: string;
	}

	interface AgentTurnResult {
		status: "completed" | "interrupted";
		consecutiveFailures: number;
	}

	/**
	 * Execute a single agent turn (proposer or challenger).
	 * Returns the turn result and updated consecutive failures count.
	 */
	async function executeAgentTurn(
		input: AgentTurnInput,
	): Promise<AgentTurnResult> {
		const {
			role,
			round,
			turnCount,
			consecutiveFailures,
			opponentRole,
			systemPrompt,
			adapterEntry,
			operationalPreamble,
		} = input;

		// Step 1: Push round.started event
		bus.push({
			kind: "round.started",
			roundNumber: round,
			speaker: role,
			timestamp: Date.now(),
		});

		// Step 2: Resolve turn preset override and effective policy
		const turnId = `${role[0]}-${round}`;
		const turnOverridePreset = config.turnPresets?.[turnId];
		const hasTurnOverride = turnOverridePreset !== undefined;
		const turnPolicy = hasTurnOverride
			? compilePolicy({
					preset: turnOverridePreset,
					role: role as "proposer" | "challenger" | "judge",
					legacyToolPolicy: adapterEntry.legacyToolPolicyInput,
				})
			: adapterEntry.baselinePolicy;

		// Only emit policy.turn.override when there IS a turn-level override
		if (hasTurnOverride && turnPolicy) {
			const observation = getObservationForPolicy(adapterEntry, turnPolicy);
			const fallbackObservation: ProviderObservationResult = {
				translation: {
					adapter: adapterEntry.session.adapterId ?? "unknown",
					nativeSummary: {},
					exactFields: [],
					approximateFields: [],
					unsupportedFields: [],
				},
				toolView: [],
				capabilityEffects: [],
				warnings: [],
				completeness: "minimal",
			};
			bus.push({
				kind: "policy.turn.override",
				role: role as "proposer" | "challenger",
				turnId,
				policy: turnPolicy,
				preset: turnOverridePreset,
				translationSummary:
					observation?.translation ?? fallbackObservation.translation,
				warnings: [...(observation?.warnings ?? [])],
				observation: observation ?? fallbackObservation,
				timestamp: Date.now(),
			});
		}

		// Step 3: Snapshot state, sync recovery max rounds, and build prompt
		const currentState = bus.snapshot();
		let prompt: string;
		if (turnCount === 1) {
			const currentMaxRounds = currentState.config.maxRounds;
			syncRecoveryMaxRounds(adapters, currentMaxRounds);
			prompt = buildInitialPrompt({
				role,
				topic: config.topic,
				maxRounds: currentMaxRounds,
				systemPrompt,
				schemaType: "debate_meta",
				...(operationalPreamble ? { operationalPreamble } : {}),
			});
		} else {
			const opponentText = getLatestTurnContent(currentState, opponentRole);
			const currentMaxRounds = currentState.config.maxRounds;
			syncRecoveryMaxRounds(adapters, currentMaxRounds);
			prompt = buildIncrementalPrompt({
				roundNumber: round,
				maxRounds: currentMaxRounds,
				opponentRole,
				opponentText,
				judgeText: lastJudgeText,
				schemaRefreshMode: getSchemaRefreshMode(
					turnCount,
					config.judgeEveryNRounds,
					consecutiveFailures,
				),
			});
		}
		prompt = appendEvidenceGuidance(prompt, role, turnPolicy);

		// Step 4: Append operational guidance from director
		prompt = appendOperationalGuidance(prompt, director.getGuidance(role));

		// Step 5: Clear lastJudgeText
		lastJudgeText = undefined;

		// Step 6: Set activeTurn, call sendTurn
		activeTurn = {
			role,
			turnId,
			adapter: adapterEntry.adapter,
			adapterId: adapterEntry.session.adapterId,
			adapterSessionId: adapterEntry.session.adapterSessionId,
		};
		await adapterEntry.adapter.sendTurn(adapterEntry.session, {
			turnId,
			prompt,
			policy: turnPolicy,
		});

		// Step 7: Await waitForTurnCompleted, clear activeTurn
		const turnResult = await waitForTurnCompleted(bus, turnId);
		activeTurn = undefined;
		if (hasTurnOverride) {
			bus.push({
				kind: "policy.turn.override.clear",
				turnId,
				timestamp: Date.now(),
			});
		}
		if (turnResult === "interrupted") {
			return { status: "interrupted", consecutiveFailures };
		}

		// Step 8: Track schema refresh failures
		const stateAfterTurn = bus.snapshot();
		const lastTurn = stateAfterTurn.turns.filter((t) => t.role === role).at(-1);
		const updatedFailures = lastTurn?.meta ? 0 : consecutiveFailures + 1;

		// Step 9: Push round.completed
		bus.push({
			kind: "round.completed",
			roundNumber: round,
			speaker: role,
			timestamp: Date.now(),
		});

		return { status: "completed", consecutiveFailures: updatedFailures };
	}

	try {
		for (
			let round = startRound;
			round <= bus.snapshot().config.maxRounds;
			round++
		) {
			await pauseGate.waitIfPaused();

			// Proposer turn
			proposerTurnCount++;
			const proposerResult = await executeAgentTurn({
				role: "proposer",
				round,
				turnCount: proposerTurnCount,
				consecutiveFailures: proposerConsecutiveFailures,
				opponentRole: "challenger",
				systemPrompt: config.proposerSystemPrompt,
				adapterEntry: adapters.proposer,
			});
			if (proposerResult.status === "interrupted") {
				return completeInterruptedDebate();
			}
			proposerConsecutiveFailures = proposerResult.consecutiveFailures;

			await pauseGate.waitIfPaused();

			// Challenger turn
			challengerTurnCount++;
			const challengerState = bus.snapshot();
			const challengerResult = await executeAgentTurn({
				role: "challenger",
				round,
				turnCount: challengerTurnCount,
				consecutiveFailures: challengerConsecutiveFailures,
				opponentRole: "proposer",
				systemPrompt: config.challengerSystemPrompt,
				adapterEntry: adapters.challenger,
				operationalPreamble:
					challengerTurnCount === 1
						? `Proposer's opening response:\n\n${getLatestTurnContent(challengerState, "proposer")}`
						: undefined,
			});
			if (challengerResult.status === "interrupted") {
				return completeInterruptedDebate();
			}
			challengerConsecutiveFailures = challengerResult.consecutiveFailures;

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
				await pauseGate.waitIfPaused();
				syncRecoveryMaxRounds(adapters, bus.snapshot().config.maxRounds);
				const judgeResult = await invokeJudge(`j-${round}`, round);
				if (judgeResult?.interrupted) return completeInterruptedDebate();
				if (handleJudgeVerdict(judgeResult?.verdict)) break;
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
				if (verdict?.interrupted) return completeInterruptedDebate();
				if (handleJudgeVerdict(verdict?.verdict)) break;
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
				await pauseGate.waitIfPaused();
				const finalState = bus.snapshot();
				syncRecoveryMaxRounds(adapters, finalState.config.maxRounds);
				const finalJudgeResult = await Promise.race([
					invokeJudge("j-final", finalState.currentRound, "full"),
					new Promise<undefined>((resolve) =>
						setTimeout(() => resolve(undefined), 30_000),
					),
				]);
				if (finalJudgeResult?.interrupted) {
					return completeInterruptedDebate();
				}
				finalVerdict = finalJudgeResult?.verdict;
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
		let synthesisQuality:
			| "llm-full"
			| "llm-recovered"
			| "local-structured"
			| "local-degraded" = "local-degraded";
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
							DEFAULT_SYNTHESIS_TIMEOUT_MS,
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
					synthesisQuality = synthRunResult?.recoveredFrom
						? "llm-recovered"
						: "llm-full";
					const meta: MarkdownReportMeta = {
						...baseMeta,
						generationQuality: synthesisQuality,
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
									recoveredFrom: synthRunResult.recoveredFrom,
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
		activeTurn = undefined;
		pauseGate.dispose();
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
			systemPrompt: resolveRecoverySystemPrompt(
				role,
				systemPrompt,
				entry.baselinePolicy,
			),
			topic: config.topic,
			role,
			maxRounds: config.maxRounds,
			schemaType,
		};
	}

	if (adapters.judge) {
		adapters.judge.session.recoveryContext = {
			systemPrompt: resolveRecoverySystemPrompt(
				"judge",
				config.judgeSystemPrompt,
				adapters.judge.baselinePolicy,
			),
			topic: config.topic,
			role: "judge",
			maxRounds: config.maxRounds,
			schemaType: "judge_verdict",
		};
	}
}

function syncRecoveryMaxRounds(adapters: AdapterMap, maxRounds: number): void {
	if (adapters.proposer.session.recoveryContext?.maxRounds !== undefined) {
		adapters.proposer.session.recoveryContext.maxRounds = maxRounds;
	}
	if (adapters.challenger.session.recoveryContext?.maxRounds !== undefined) {
		adapters.challenger.session.recoveryContext.maxRounds = maxRounds;
	}
	if (adapters.judge?.session.recoveryContext) {
		adapters.judge.session.recoveryContext.maxRounds = maxRounds;
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
				resolve(
					(event as { status?: "completed" | "interrupted" }).status ===
						"interrupted"
						? "interrupted"
						: "completed",
				);
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
