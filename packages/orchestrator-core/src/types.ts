import type { PolicyPreset } from "@crossfire/adapter-core";

export type DebateRole = "proposer" | "challenger";
export type PromptTemplateFamily = "general" | "code";

export type TerminationReason =
	| "max-rounds"
	| "convergence"
	| "judge-decision"
	| "error"
	| "interrupted"
	| "user-interrupt"
	| "stagnation-limit";

export interface Clarification {
	question: string;
	answer: string;
	answeredBy: "user" | "judge";
	roundNumber: number;
}

export interface DebateConfig {
	topic: string;
	maxRounds: number;
	judgeEveryNRounds: number;
	convergenceThreshold: number;
	turnPresets?: Record<string, PolicyPreset>;
	promptTemplates?: {
		defaultSelection?: "auto" | PromptTemplateFamily;
		proposer?: PromptTemplateFamily;
		challenger?: PromptTemplateFamily;
		judge?: PromptTemplateFamily;
	};
	proposerModel?: string;
	challengerModel?: string;
	judgeModel?: string;
	proposerSystemPrompt?: string;
	challengerSystemPrompt?: string;
	judgeSystemPrompt?: string;
}

export interface DebateMeta {
	stance:
		| "strongly_agree"
		| "agree"
		| "neutral"
		| "disagree"
		| "strongly_disagree";
	confidence: number;
	keyPoints: string[];
	concessions?: string[];
	wantsToConclude?: boolean;
	requestIntervention?: {
		type: "clarification" | "arbitration";
		question: string;
	};
	// New optional enrichment fields (Phase 1: opportunistic, not mandatory)
	rebuttals?: Array<{ target: string; response: string }>;
	evidence?: Array<{ claim: string; source: string }>;
	riskFlags?: Array<{ risk: string; severity: "low" | "medium" | "high" }>;
	positionShifts?: Array<{ from: string; to: string; reason: string }>;
}

export interface JudgeVerdict {
	leading: "proposer" | "challenger" | "tie";
	score: { proposer: number; challenger: number };
	reasoning: string;
	shouldContinue: boolean;
	repetitionScore?: { proposer: number; challenger: number };
	clarificationResponse?: {
		answered: boolean;
		answer?: string;
		relay?: string;
	};
}

export interface ConvergenceResult {
	converged: boolean;
	stanceDelta: number;
	mutualConcessions: number;
	bothWantToConclude: boolean;
	singlePartyStrongConvergence?: { role: DebateRole; rounds: number };
}

export interface DebateTurn {
	roundNumber: number;
	role: DebateRole;
	content: string;
	meta?: DebateMeta;
	judgeVerdict?: JudgeVerdict;
}

export interface DebateState {
	config: DebateConfig;
	phase: "idle" | "proposer-turn" | "challenger-turn" | "judging" | "completed";
	paused: boolean;
	currentRound: number;
	turns: DebateTurn[];
	convergence: ConvergenceResult;
	terminationReason?: TerminationReason;
}

/** Runtime type guard: value is a non-null object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
