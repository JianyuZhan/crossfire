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

export interface PromptStatsEvent {
	kind: "prompt.stats";
	roundNumber: number;
	speaker: "proposer" | "challenger" | "judge";
	promptChars: number;
	timestamp: number;
}

export interface SummaryGeneratingEvent {
	kind: "summary.generating";
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
	| UserInjectEvent
	| ClarificationRequestedEvent
	| ClarificationProvidedEvent
	| DirectorActionEvent
	| PromptStatsEvent
	| SummaryGeneratingEvent;
