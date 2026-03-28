import type { AdapterCapabilities } from "./capabilities.js";

export type AdapterId = "claude" | "codex" | "gemini";

export type DebateRole = "proposer" | "challenger" | "judge";

export type NormalizedEvent =
	| SessionStartedEvent
	| MessageDeltaEvent
	| MessageFinalEvent
	| ThinkingDeltaEvent
	| PlanUpdatedEvent
	| ToolCallEvent
	| ToolProgressEvent
	| ToolResultEvent
	| ApprovalRequestEvent
	| ApprovalResolvedEvent
	| SubagentStartedEvent
	| SubagentCompletedEvent
	| UsageUpdatedEvent
	| TurnCompletedEvent
	| RunErrorEvent
	| RunWarningEvent;

export interface BaseEvent {
	kind: string;
	timestamp: number;
	adapterId: AdapterId;
	adapterSessionId: string;
	turnId?: string;
}

// -- Session lifecycle --

export interface SessionStartedEvent extends BaseEvent {
	kind: "session.started";
	model: string;
	tools: string[];
	providerSessionId: string; // Provider-native session/thread ID (always available at emission time)
	capabilities: AdapterCapabilities;
}

// -- Text stream --

export interface MessageDeltaEvent extends BaseEvent {
	kind: "message.delta";
	text: string;
	role: "assistant";
}

export interface MessageFinalEvent extends BaseEvent {
	kind: "message.final";
	text: string;
	role: "assistant";
	stopReason?: string;
}

// -- Thinking / reasoning --

export interface ThinkingDeltaEvent extends BaseEvent {
	kind: "thinking.delta";
	text: string;
	thinkingType: "raw-thinking" | "reasoning-summary";
}

// -- Plan (Codex-specific, others may omit) --

export interface PlanUpdatedEvent extends BaseEvent {
	kind: "plan.updated";
	steps: Array<{
		description: string;
		status: "pending" | "in_progress" | "completed" | "failed";
	}>;
}

// -- Tool lifecycle --

export interface ToolCallEvent extends BaseEvent {
	kind: "tool.call";
	toolUseId: string;
	toolName: string;
	input: unknown;
}

export interface ToolProgressEvent extends BaseEvent {
	kind: "tool.progress";
	toolUseId: string;
	toolName: string;
	elapsedSeconds: number;
}

export interface ToolResultEvent extends BaseEvent {
	kind: "tool.result";
	toolUseId: string;
	toolName: string;
	success: boolean;
	output?: unknown;
	error?: string;
}

// -- Approval --

export interface ApprovalRequestEvent extends BaseEvent {
	kind: "approval.request";
	requestId: string;
	approvalType: "tool" | "command" | "file-change" | "user-input";
	title: string;
	payload: unknown;
	suggestion?: "allow" | "deny";
}

export interface ApprovalResolvedEvent extends BaseEvent {
	kind: "approval.resolved";
	requestId: string;
	decision: "allow" | "deny" | "allow-always";
}

// -- Subagent --

export interface SubagentStartedEvent extends BaseEvent {
	kind: "subagent.started";
	subagentId: string;
	description?: string;
}

export interface SubagentCompletedEvent extends BaseEvent {
	kind: "subagent.completed";
	subagentId: string;
}

// -- Usage & metrics --

export type ProviderUsageSemantics =
	| "per_turn"
	| "cumulative_thread_total"
	| "session_delta_or_cached"
	| "unknown";

/** Local metrics measured at the adapter boundary before sending to provider */
export interface LocalTurnMetrics {
	semanticChars: number;
	semanticUtf8Bytes: number;
	adapterOverheadChars: number;
	adapterOverheadUtf8Bytes: number;
	totalChars: number;
	totalUtf8Bytes: number;
	totalTokensEstimate?: number;
	tokenEstimateMethod?: string;
}

/** Shared usage shape used by UsageUpdatedEvent and TurnCompletedEvent */
export interface UsageSnapshot {
	inputTokens: number;
	outputTokens: number;
	totalCostUsd?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	semantics?: ProviderUsageSemantics;
	localMetrics?: LocalTurnMetrics;
}

export interface ProviderUsageMetrics {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	raw?: unknown;
	semantics: ProviderUsageSemantics;
}

export interface UsageUpdatedEvent extends BaseEvent, UsageSnapshot {
	kind: "usage.updated";
}

/** Record of a completed turn for universal transcript fallback */
export interface TurnRecord {
	roundNumber: number;
	role: DebateRole;
	content: string;
	/** Lightweight extracted metadata -- avoids circular dependency on orchestrator-core */
	meta?: {
		stance?: string;
		confidence?: number;
		keyPoints?: string[];
		concessions?: string[];
	};
}

// -- Turn completion --

export interface TurnCompletedEvent extends BaseEvent {
	kind: "turn.completed";
	status: "completed" | "interrupted" | "failed" | "timeout";
	/** Wall-clock ms from sendTurn() call to turn end, measured by adapter */
	durationMs: number;
	usage?: UsageSnapshot;
}

// -- Errors --

export interface RunErrorEvent extends BaseEvent {
	kind: "run.error";
	message: string;
	recoverable: boolean;
}

export interface RunWarningEvent extends BaseEvent {
	kind: "run.warning";
	message: string;
}

// -- AgentAdapter Interface --

export interface StartSessionInput {
	profile: string;
	workingDirectory: string;
	model?: string;
	mcpServers?: Record<string, unknown>;
	permissionMode?: "auto" | "approve-all" | "deny-all";
	providerOptions?: Record<string, unknown>;
}

/** Recovery context stored on the session handle for transcript-based fallback */
export interface RecoveryContext {
	systemPrompt: string;
	topic: string;
	role: DebateRole;
	maxRounds: number;
	schemaType: "debate_meta" | "judge_verdict";
}

export interface SessionHandle {
	adapterSessionId: string;
	/** undefined until provider session established. Codex: set during startSession(). Claude/Gemini: set on first sendTurn(). */
	providerSessionId: string | undefined;
	adapterId: AdapterId;
	/** Universal transcript of completed turns -- enables recovery prompt reconstruction */
	transcript: TurnRecord[];
	/** Recovery context populated by the runner -- enables transcript-based session recovery */
	recoveryContext?: RecoveryContext;
}

export interface TurnInput {
	prompt: string;
	turnId: string;
	timeout?: number;
	/** Role hint for transcript tracking -- if omitted, parsed from turnId pattern {p|c|j}-{round} */
	role?: DebateRole;
	/** Round number hint for transcript tracking -- if omitted, parsed from turnId pattern */
	roundNumber?: number;
}

export interface TurnHandle {
	turnId: string;
	status: "running" | "completed" | "interrupted" | "failed";
}

export interface ApprovalDecision {
	requestId: string;
	decision: "allow" | "deny" | "allow-always";
	updatedInput?: unknown;
}

const TURN_ID_ROLE_MAP: Record<string, DebateRole> = {
	p: "proposer",
	c: "challenger",
	j: "judge",
};

/**
 * Parse a turnId like "p-1", "c-2", "j-3" into role and roundNumber.
 * Returns undefined values when the pattern doesn't match.
 */
export function parseTurnId(turnId: string): {
	role: DebateRole | undefined;
	roundNumber: number | undefined;
} {
	const match = turnId.match(/^([pcj])-(\d+)$/);
	if (!match) return { role: undefined, roundNumber: undefined };
	return {
		role: TURN_ID_ROLE_MAP[match[1]],
		roundNumber: Number.parseInt(match[2], 10),
	};
}

export interface AgentAdapter {
	readonly id: string;
	readonly capabilities: AdapterCapabilities;

	startSession(input: StartSessionInput): Promise<SessionHandle>;
	sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle>;
	onEvent(cb: (e: NormalizedEvent) => void): () => void; // Returns unsubscribe
	approve?(req: ApprovalDecision): Promise<void>;
	interrupt?(turnId: string): Promise<void>;
	close(handle: SessionHandle): Promise<void>;
}
