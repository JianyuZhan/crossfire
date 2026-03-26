import type { DebateState, JudgeVerdict } from "@crossfire/orchestrator-core";

export interface LiveToolEntry {
	toolUseId: string;
	toolName: string;
	inputSummary: string;
	status: "running" | "done" | "error";
	elapsedMs?: number;
	resultSummary?: string;
	expanded: boolean;
}

export interface PlanStep {
	id: string;
	title: string;
	status: string;
}

/** Snapshot of a single agent's completed turn within a round */
export interface AgentTurnSnapshot {
	messageText: string;
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
	status: "idle" | "thinking" | "tool" | "speaking" | "done" | "error";
	thinkingText: string;
	currentMessageText: string;
	tools: LiveToolEntry[];
	latestPlan?: PlanStep[];
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
	approvalType: string;
	title: string;
	suggestion?: "allow" | "deny";
}

export interface CommandState {
	mode: "normal" | "approval" | "replay";
	pendingApprovals: PendingApproval[];
	replaySpeed?: number;
	replayPaused?: boolean;
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
			status: string;
			duration?: number;
	  }
	| { kind: "thinking"; text: string }
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
