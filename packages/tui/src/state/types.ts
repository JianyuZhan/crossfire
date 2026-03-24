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
}

/** Judge evaluation result for a specific round */
export interface JudgeRoundResult {
  roundNumber: number;
  status: "evaluating" | "done";
  messageText: string;
  verdict?: JudgeVerdict;
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
  judgeScore?: { proposer: number; challenger: number };
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
  summary?: DebateSummaryView;
}
