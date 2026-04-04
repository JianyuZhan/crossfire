import type {
	ApprovalCapabilities,
	ApprovalOption,
	ProviderUsageSemantics,
} from "@crossfire/adapter-core";
import type {
	DebateState,
	JudgeVerdict,
	RuntimePolicyState,
} from "@crossfire/orchestrator-core";

export interface LiveToolEntry {
	toolUseId: string;
	toolName: string;
	inputSummary: string;
	status:
		| "requested"
		| "running"
		| "succeeded"
		| "failed"
		| "denied"
		| "unknown";
	startedAtMs?: number;
	elapsedMs?: number;
	resultSummary?: string;
	expanded: boolean;
}

export type PlanStepStatus = "completed" | "in_progress" | "pending" | "failed";

export interface PlanStep {
	id: string;
	title: string;
	status: PlanStepStatus;
}

export interface SubagentEntry {
	subagentId: string;
	description?: string;
	status: "running" | "completed";
}

/** Snapshot of a single agent's completed turn within a round */
export interface AgentTurnSnapshot {
	messageText: string;
	narrationTexts?: string[];
	executionMode?: string;
	thinkingText?: string;
	thinkingType?: "raw-thinking" | "reasoning-summary";
	latestPlan?: PlanStep[];
	subagents?: SubagentEntry[];
	tools: LiveToolEntry[];
	turnDurationMs?: number;
	turnStatus?: "completed" | "interrupted" | "failed" | "timeout";
	warnings: string[];
	error?: string;
}

/** A round containing both agents' turn snapshots */
export interface TuiRound {
	roundNumber: number;
	proposer?: AgentTurnSnapshot;
	challenger?: AgentTurnSnapshot;
	collapsed?: boolean;
	userCollapsed?: boolean;
}

/** Judge evaluation result for a specific round */
export interface JudgeRoundResult {
	roundNumber: number;
	status: "evaluating" | "done";
	messageText: string;
	verdict?: JudgeVerdict;
}

/** Structured collapsed round summary with separate P/C/Judge lines */
export interface CollapsedRoundSummary {
	proposerLine: string;
	challengerLine: string;
	judgeLine?: string;
}

/** Live streaming state for the currently active agent */
export interface LiveAgentPanelState {
	role: "proposer" | "challenger";
	agentType?: string;
	model?: string;
	executionMode?: string;
	status: "idle" | "thinking" | "tool" | "speaking" | "done" | "error";
	thinkingText: string;
	thinkingType?: "raw-thinking" | "reasoning-summary";
	narrationTexts: string[];
	currentMessageText: string;
	tools: LiveToolEntry[];
	latestPlan?: PlanStep[];
	subagents?: SubagentEntry[];
	warnings: string[];
	error?: string;
	turnDurationMs?: number;
	turnStatus?: "completed" | "interrupted" | "failed" | "timeout";
}

export interface JudgeStripState {
	visible: boolean;
	roundNumber: number;
	proposerStance?: string;
	proposerConfidence?: number;
	challengerStance?: string;
	challengerConfidence?: number;
	verdict?: JudgeVerdict;
	judgeStatus: "idle" | "evaluating" | "done";
	judgeMessageText: string;
	convergenceDelta?: number;
}

export interface AgentUsage {
	tokens: number;
	costUsd: number;
	semantics?: ProviderUsageSemantics;
	// Local metrics (from adapter layer)
	localTotalChars?: number;
	localTotalUtf8Bytes?: number;
	// Codex delta tracking
	previousCumulativeInput?: number;
	lastDeltaInput?: number;
	// Claude cache display
	cacheReadTokens?: number;
	observedInputPlusCacheRead?: number;
}

export interface MetricsState {
	debateId?: string;
	currentRound: number;
	maxRounds: number;
	convergencePercent: number;
	stanceDelta: number;
	proposerStance?: string;
	proposerConfidence?: number;
	challengerStance?: string;
	challengerConfidence?: number;
	mutualConcessions: number;
	bothWantToConclude: boolean;
	judgeVerdict?: { shouldContinue: boolean; leading?: string };
	totalTokens: number;
	totalCostUsd?: number;
	proposerUsage: AgentUsage;
	challengerUsage: AgentUsage;
}

export interface PendingApproval {
	requestId: string;
	adapterId: string;
	adapterSessionId: string;
	approvalType: string;
	title: string;
	detail?: string;
	suggestion?: "allow" | "deny";
	capabilities?: ApprovalCapabilities;
	options?: ApprovalOption[];
}

export interface CommandState {
	mode: "normal" | "approval" | "replay";
	pendingApprovals: PendingApproval[];
	livePaused?: boolean;
	replaySpeed?: number;
	replayPaused?: boolean;
	lastOutput?: string;
}

export interface DebateSummaryView {
	terminationReason: string;
	roundsCompleted: number;
	leading: string;
	judgeScore: { proposer: number; challenger: number } | null;
	recommendedAction: string | null;
	consensus: string[];
	unresolved: string[];
	totalTurns: number;
	outputDir?: string;
}

/** Session-scoped policy state, keyed by debateId then role. */
export interface PolicySessionState {
	debateId: string;
	roles: Record<string, RuntimePolicyState>;
}

export interface TuiState {
	proposer: LiveAgentPanelState;
	challenger: LiveAgentPanelState;
	rounds: TuiRound[];
	judgeResults: JudgeRoundResult[];
	judge: JudgeStripState;
	metrics: MetricsState;
	command: CommandState;
	debateState: DebateState;
	summaryGenerating?: boolean;
	summary?: DebateSummaryView;
	policySession?: PolicySessionState;
}

// ── Viewport Scrolling Types ──

export interface ViewportState {
	scrollOffset: number;
	autoFollow: boolean;
	viewportHeight: number;
	contentWidth: number;
	contentHeight: number;
}

export interface StyledSegment {
	text: string;
	style: {
		bold?: boolean;
		dim?: boolean;
		color?: string;
		italic?: boolean;
	};
}

export interface ScreenLine {
	segments: StyledSegment[];
	displayWidth: number;
}

export type RenderBlock =
	| {
			kind: "agent-header";
			role: "proposer" | "challenger";
			agentType?: string;
			executionMode?: string;
			status: "idle" | "thinking" | "tool" | "speaking" | "done" | "error";
			statusLabel?: string;
			duration?: number;
	  }
	| {
			kind: "thinking";
			text: string;
			thinkingType?: "raw-thinking" | "reasoning-summary";
	  }
	| { kind: "plan"; steps: PlanStep[] }
	| {
			kind: "subagent";
			description: string;
			status: "running" | "completed";
	  }
	| {
			kind: "tool-call";
			toolName: string;
			status: "running" | "success" | "error";
			summary?: string;
			elapsedMs?: number;
	  }
	| { kind: "message"; text: string; isFinal: boolean }
	| { kind: "warning"; text: string }
	| { kind: "error"; text: string }
	| { kind: "separator" };

export interface ChunkLayoutMeta {
	startLine: number;
	endLine: number;
}

export interface RoundRenderChunk {
	type: "round";
	roundNumber: number;
	maxRounds: number;
	active: boolean;
	collapsed: boolean;
	collapsedSummary?: CollapsedRoundSummary;
	leftBlocks?: RenderBlock[];
	rightBlocks?: RenderBlock[];
	leftLines: ScreenLine[];
	rightLines: ScreenLine[];
	height: number;
	layoutMeta?: ChunkLayoutMeta;
	judgeResult?: JudgeRoundResult;
}

export interface JudgeRenderChunk {
	type: "judge";
	roundNumber: number;
	status: "streaming" | "done";
	shouldContinue?: boolean;
	lines: ScreenLine[];
	layoutMeta?: ChunkLayoutMeta;
}

export interface SummaryRenderChunk {
	type: "summary";
	lines: ScreenLine[];
	layoutMeta?: ChunkLayoutMeta;
}

export type ContentChunk =
	| RoundRenderChunk
	| JudgeRenderChunk
	| SummaryRenderChunk;

export interface RenderSnapshot {
	state: TuiState;
	viewport: ViewportState;
	visibleLines: ScreenLine[];
}
