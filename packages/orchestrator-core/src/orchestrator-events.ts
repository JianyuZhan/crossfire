import type {
	PolicyClampNote,
	PolicyPreset,
	PolicyTranslationSummary,
	PolicyTranslationWarning,
	PresetSource,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import type { DirectorAction, DirectorSignal } from "./director/types.js";
import type {
	DebateConfig,
	DebateRole,
	JudgeVerdict,
	TerminationReason,
} from "./types.js";

export interface RoleInfo {
	agentType: string;
	model?: string;
}

export interface DebateStartedEvent {
	kind: "debate.started";
	debateId?: string;
	config: DebateConfig;
	roles?: {
		proposer?: RoleInfo;
		challenger?: RoleInfo;
		judge?: RoleInfo;
	};
	timestamp: number;
}

export interface RoundStartedEvent {
	kind: "round.started";
	roundNumber: number;
	speaker: DebateRole;
	timestamp: number;
}

export interface PolicyBaselineEvent {
	kind: "policy.baseline";
	role: "proposer" | "challenger" | "judge";
	policy: ResolvedPolicy;
	clamps: PolicyClampNote[];
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	translationSummary: PolicyTranslationSummary;
	warnings: PolicyTranslationWarning[];
	timestamp: number;
}

export interface PolicyTurnOverrideEvent {
	kind: "policy.turn.override";
	role: "proposer" | "challenger";
	turnId: string;
	policy: ResolvedPolicy;
	preset: PolicyPreset;
	translationSummary: PolicyTranslationSummary;
	warnings: PolicyTranslationWarning[];
	timestamp: number;
}

export interface PolicyTurnOverrideClearEvent {
	kind: "policy.turn.override.clear";
	turnId: string;
	timestamp: number;
}

export interface RuntimePolicyState {
	baseline: {
		policy: ResolvedPolicy;
		clamps: PolicyClampNote[];
		preset: {
			value: PolicyPreset;
			source: PresetSource;
		};
		translationSummary: PolicyTranslationSummary;
		warnings: PolicyTranslationWarning[];
	};
	currentTurnOverride?: {
		turnId: string;
		policy: ResolvedPolicy;
		preset: PolicyPreset;
		translationSummary: PolicyTranslationSummary;
		warnings: PolicyTranslationWarning[];
	};
}

export interface RoundCompletedEvent {
	kind: "round.completed";
	roundNumber: number;
	speaker: DebateRole;
	timestamp: number;
}

export interface JudgeStartedEvent {
	kind: "judge.started";
	roundNumber: number;
	timestamp: number;
}

export interface JudgeCompletedEvent {
	kind: "judge.completed";
	roundNumber: number;
	verdict?: JudgeVerdict;
	timestamp: number;
}

export interface DebateCompletedEvent {
	kind: "debate.completed";
	reason: TerminationReason;
	summary?: unknown;
	outputDir?: string;
	timestamp: number;
}

export interface DebateResumedEvent {
	kind: "debate.resumed";
	fromRound: number;
	timestamp: number;
}

export interface DebatePausedEvent {
	kind: "debate.paused";
	timestamp: number;
}

export interface DebateUnpausedEvent {
	kind: "debate.unpaused";
	timestamp: number;
}

export interface DebateExtendedEvent {
	kind: "debate.extended";
	by: number;
	newMaxRounds: number;
	timestamp: number;
}

export interface TurnInterruptRequestedEvent {
	kind: "turn.interrupt.requested";
	target: "current" | "proposer" | "challenger" | "judge";
	timestamp: number;
}

export interface UserInjectEvent {
	kind: "user.inject";
	target: "proposer" | "challenger" | "both" | "judge";
	text: string;
	priority: "normal" | "high";
	timestamp: number;
}

export interface ClarificationRequestedEvent {
	kind: "clarification.requested";
	source: "proposer" | "challenger";
	question: string;
	judgeComment?: string;
	timestamp: number;
}

export interface ClarificationProvidedEvent {
	kind: "clarification.provided";
	answer: string;
	answeredBy: "user" | "judge";
	timestamp: number;
}

export interface DirectorActionEvent {
	kind: "director.action";
	action: DirectorAction;
	signals: DirectorSignal[];
	timestamp: number;
}

/** Lightweight debug summary safe for JSONL event serialization */
export interface SynthesisAuditSummary {
	budgetTier: "short" | "medium" | "long";
	totalEstimatedTokens: number;
	budgetTokens: number;
	promptCharLength: number;
	fullTextRounds: number[];
	compressedRounds: number[];
	shrinkTrace: Array<{
		step: string;
		beforeTokens: number;
		afterTokens: number;
		detail?: string;
	}>;
	fitAchieved: boolean;
	durationMs: number;
}

export interface SynthesisStartedEvent {
	kind: "synthesis.started";
	timestamp: number;
}

export interface SynthesisCompletedEvent {
	kind: "synthesis.completed";
	quality: "llm-full" | "llm-recovered" | "local-structured" | "local-degraded";
	timestamp: number;
	debug?: SynthesisAuditSummary;
}

export interface SynthesisErrorEvent {
	kind: "synthesis.error";
	phase: "judge-final" | "prompt-assembly" | "llm-synthesis" | "file-write";
	message: string;
	timestamp: number;
}

export type OrchestratorEvent =
	| DebateStartedEvent
	| RoundStartedEvent
	| RoundCompletedEvent
	| JudgeStartedEvent
	| JudgeCompletedEvent
	| DebateCompletedEvent
	| DebateResumedEvent
	| DebatePausedEvent
	| DebateUnpausedEvent
	| DebateExtendedEvent
	| TurnInterruptRequestedEvent
	| UserInjectEvent
	| ClarificationRequestedEvent
	| ClarificationProvidedEvent
	| DirectorActionEvent
	| SynthesisStartedEvent
	| SynthesisCompletedEvent
	| SynthesisErrorEvent
	| PolicyBaselineEvent
	| PolicyTurnOverrideEvent
	| PolicyTurnOverrideClearEvent;
