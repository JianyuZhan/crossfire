import {
  type AnyEvent,
  type DebateState,
  projectState,
} from "@crossfire/orchestrator-core";
import type {
  AgentTurnSnapshot,
  AgentUsage,
  CommandState,
  JudgeRoundResult,
  JudgeStripState,
  LiveAgentPanelState,
  MetricsState,
  TuiRound,
  TuiState,
} from "./types.js";

const MAX_THINKING_BYTES = 4096;

/** Internal meta-tool names that should not appear in the TUI */
const INTERNAL_TOOLS = new Set(["debate_meta", "judge_verdict"]);

/** Strip markdown code blocks containing internal tool calls from display text */
export function stripInternalToolBlocks(text: string): string {
  return (
    text
      // Complete fenced blocks: ```debate_meta ... ```
      .replace(/```(?:debate_meta|judge_verdict)\s*[\s\S]*?```\s*/g, "")
      // Incomplete trailing fenced block (streaming — closing ``` hasn't arrived yet)
      .replace(/```(?:debate_meta|judge_verdict)[\s\S]*$/g, "")
      // Bare label followed by JSON (no backtick fencing, e.g. Codex output)
      .replace(/\n?(?:debate_meta|judge_verdict)\s*\n\s*\{[\s\S]*?\}\s*$/g, "")
      .trim()
  );
}

function defaultAgentPanel(
  role: "proposer" | "challenger",
): LiveAgentPanelState {
  return {
    role,
    status: "idle",
    thinkingText: "",
    currentMessageText: "",
    tools: [],
    warnings: [],
  };
}

function defaultJudge(): JudgeStripState {
  return {
    visible: false,
    roundNumber: 0,
    judgeStatus: "idle",
    judgeMessageText: "",
  };
}

function defaultUsage(): AgentUsage {
  return { tokens: 0, costUsd: 0 };
}

function defaultMetrics(): MetricsState {
  return {
    currentRound: 0,
    maxRounds: 0,
    convergencePercent: 0,
    stanceDelta: 1.0,
    mutualConcessions: 0,
    bothWantToConclude: false,
    totalTokens: 0,
    proposerUsage: defaultUsage(),
    challengerUsage: defaultUsage(),
  };
}

function defaultCommand(): CommandState {
  return { mode: "normal", pendingApprovals: [] };
}

const DEFAULT_CONFIG = {
  topic: "",
  maxRounds: 10,
  judgeEveryNRounds: 0,
  convergenceThreshold: 0.3,
};

const DEFAULT_DEBATE_STATE: DebateState = {
  config: DEFAULT_CONFIG,
  phase: "idle",
  currentRound: 0,
  turns: [],
  convergence: {
    converged: false,
    stanceDelta: 1.0,
    mutualConcessions: 0,
    bothWantToConclude: false,
  },
};

function captureSnapshot(panel: LiveAgentPanelState): AgentTurnSnapshot {
  return {
    messageText: stripInternalToolBlocks(panel.currentMessageText),
    tools: panel.tools.map((t) => ({ ...t, expanded: false })),
    turnDurationMs: panel.turnDurationMs,
    turnStatus: panel.turnStatus,
    warnings: [...panel.warnings],
    error: panel.error,
  };
}

export class TuiStore {
  private state: TuiState;
  private readonly listeners: Set<() => void> = new Set();
  private readonly allEvents: AnyEvent[] = [];
  private activeSpeaker: "proposer" | "challenger" | undefined;
  private activeJudgeTurnId: string | undefined;

  // Only re-project full state on structural events (not high-frequency deltas)
  private static readonly STRUCTURAL_KINDS = new Set([
    "debate.started",
    "round.started",
    "round.completed",
    "judge.started",
    "judge.completed",
    "debate.completed",
    "message.final",
    "tool.call",
    "turn.completed",
  ]);

  constructor() {
    this.state = {
      proposer: defaultAgentPanel("proposer"),
      challenger: defaultAgentPanel("challenger"),
      rounds: [],
      judgeResults: [],
      judge: defaultJudge(),
      metrics: defaultMetrics(),
      command: defaultCommand(),
      debateState: DEFAULT_DEBATE_STATE,
    };
  }

  handleEvent(event: AnyEvent): void {
    this.allEvents.push(event);
    this.applyEvent(event);

    if (TuiStore.STRUCTURAL_KINDS.has(event.kind)) {
      this.state.debateState = projectState(this.allEvents);
    }

    const ds = this.state.debateState;
    this.state.metrics.currentRound = ds.currentRound;
    this.state.metrics.stanceDelta = ds.convergence.stanceDelta;
    this.state.metrics.mutualConcessions = ds.convergence.mutualConcessions;
    this.state.metrics.bothWantToConclude = ds.convergence.bothWantToConclude;
    this.state.metrics.convergencePercent = Math.round(
      Math.max(0, 1 - ds.convergence.stanceDelta / 1.0) * 100,
    );

    for (const cb of this.listeners) cb();
  }

  getState(): Readonly<TuiState> {
    return this.state;
  }

  toggleRoundCollapse(roundNumber: number): void {
    const round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
    if (round && round.proposer && round.challenger) {
      round.collapsed = !round.collapsed;
      for (const cb of this.listeners) cb();
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private panel(): LiveAgentPanelState | undefined {
    if (!this.activeSpeaker) return undefined;
    return this.state[this.activeSpeaker];
  }

  private activeJudgeResult(): JudgeRoundResult | undefined {
    // Find the last "evaluating" entry in judgeResults
    for (let i = this.state.judgeResults.length - 1; i >= 0; i--) {
      if (this.state.judgeResults[i].status === "evaluating") {
        return this.state.judgeResults[i];
      }
    }
    return undefined;
  }

  private getOrCreateRound(roundNumber: number): TuiRound {
    let round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
    if (!round) {
      round = { roundNumber };
      this.state.rounds.push(round);
    }
    return round;
  }

  private applyEvent(event: AnyEvent): void {
    switch (event.kind) {
      case "debate.started": {
        const e = event as {
          config: typeof DEFAULT_CONFIG;
          roles?: {
            proposer?: { agentType: string; model?: string };
            challenger?: { agentType: string; model?: string };
          };
        };
        this.state.metrics.maxRounds = e.config.maxRounds;
        if ((event as { debateId?: string }).debateId) {
          this.state.metrics.debateId = (
            event as { debateId: string }
          ).debateId;
        }
        if (e.roles?.proposer) {
          this.state.proposer.agentType = e.roles.proposer.agentType;
          this.state.proposer.model = e.roles.proposer.model;
        }
        if (e.roles?.challenger) {
          this.state.challenger.agentType = e.roles.challenger.agentType;
          this.state.challenger.model = e.roles.challenger.model;
        }
        break;
      }
      case "session.started": {
        // SDK reports the real model ID — backfill if not set from debate.started
        const p = this.panel();
        if (p && !p.model) {
          const e = event as { model?: string };
          if (e.model) p.model = e.model;
        }
        break;
      }
      case "round.started": {
        const e = event as {
          roundNumber: number;
          speaker: "proposer" | "challenger";
        };
        this.activeSpeaker = e.speaker;
        const p = this.state[e.speaker];
        p.thinkingText = "";
        p.currentMessageText = "";
        p.tools = [];
        p.warnings = [];
        p.error = undefined;
        p.status = "thinking";
        p.turnDurationMs = undefined;
        p.turnStatus = undefined;
        // Clear completed judge panel when new round begins
        if (this.state.judge.visible) {
          this.state.judge.visible = false;
          this.state.judge.judgeStatus = "idle";
        }
        // Auto-collapse previous completed rounds when a new round's proposer starts
        if (e.speaker === "proposer") {
          for (const r of this.state.rounds) {
            if (r.proposer && r.challenger) r.collapsed = true;
          }
        }
        // Ensure round entry exists
        this.getOrCreateRound(e.roundNumber);
        break;
      }
      case "round.completed": {
        const e = event as {
          roundNumber: number;
          speaker: "proposer" | "challenger";
        };
        // Snapshot completed turn into the round
        const round = this.getOrCreateRound(e.roundNumber);
        round[e.speaker] = captureSnapshot(this.state[e.speaker]);
        this.activeSpeaker = undefined;
        break;
      }
      case "thinking.delta": {
        const p = this.panel();
        if (!p) break;
        const e = event as { text: string };
        if (p.status === "idle") {
          p.thinkingText = "";
          p.currentMessageText = "";
        }
        p.status = "thinking";
        p.thinkingText += e.text;
        if (p.thinkingText.length > MAX_THINKING_BYTES) {
          p.thinkingText = p.thinkingText.slice(-MAX_THINKING_BYTES);
        }
        break;
      }
      case "message.delta": {
        const p = this.panel();
        if (p) {
          if (p.status === "idle") {
            p.thinkingText = "";
            p.currentMessageText = "";
          }
          p.status = "speaking";
          p.currentMessageText += (event as { text: string }).text;
        } else if (this.state.judge.judgeStatus === "evaluating") {
          // Route judge message to judge panel
          this.state.judge.judgeMessageText += (event as { text: string }).text;
          // Also update the active judgeResults entry
          const jr = this.activeJudgeResult();
          if (jr) jr.messageText = this.state.judge.judgeMessageText;
        }
        break;
      }
      case "message.final": {
        const p = this.panel();
        if (p) {
          p.thinkingText = "";
          p.currentMessageText = stripInternalToolBlocks(
            (event as { text: string }).text,
          );
          p.status = "done";
        } else if (this.state.judge.judgeStatus === "evaluating") {
          // Route judge final message to judge panel
          this.state.judge.judgeMessageText = stripInternalToolBlocks(
            (event as { text: string }).text,
          );
          const jr = this.activeJudgeResult();
          if (jr) jr.messageText = this.state.judge.judgeMessageText;
        }
        break;
      }
      case "tool.call": {
        const p = this.panel();
        if (!p) break;
        const e = event as {
          toolUseId: string;
          toolName: string;
          input: unknown;
        };
        if (INTERNAL_TOOLS.has(e.toolName)) break;
        if (p.status === "idle") {
          p.thinkingText = "";
          p.currentMessageText = "";
        }
        p.status = "tool";
        p.tools.push({
          toolUseId: e.toolUseId,
          toolName: e.toolName,
          inputSummary: JSON.stringify(e.input).slice(0, 100),
          status: "running",
          expanded: true,
        });
        break;
      }
      case "tool.progress": {
        const p = this.panel();
        if (!p) break;
        const e = event as { toolUseId: string; elapsedMs?: number };
        const tool = p.tools.find((t) => t.toolUseId === e.toolUseId);
        if (tool && e.elapsedMs !== undefined) tool.elapsedMs = e.elapsedMs;
        break;
      }
      case "tool.result": {
        const p = this.panel();
        if (!p) break;
        const e = event as {
          toolUseId: string;
          toolName: string;
          success: boolean;
        };
        const tool = p.tools.find((t) => t.toolUseId === e.toolUseId);
        if (tool) {
          tool.status = e.success ? "done" : "error";
          tool.resultSummary = e.success ? "success" : "error";
        }
        break;
      }
      case "turn.completed": {
        const p = this.panel();
        if (!p) break;
        const e = event as {
          status: "completed" | "interrupted" | "failed" | "timeout";
          durationMs: number;
        };
        p.status = "done";
        p.turnDurationMs = e.durationMs;
        p.turnStatus = e.status;
        for (const tool of p.tools) tool.expanded = false;
        break;
      }
      case "approval.request": {
        const e = event as {
          requestId: string;
          adapterId: string;
          approvalType: string;
          title: string;
          suggestion?: "allow" | "deny";
        };
        this.state.command.pendingApprovals.push({
          requestId: e.requestId,
          adapterId: e.adapterId,
          approvalType: e.approvalType,
          title: e.title,
          suggestion: e.suggestion,
        });
        this.state.command.mode = "approval";
        break;
      }
      case "approval.resolved": {
        const e = event as { requestId: string };
        this.state.command.pendingApprovals =
          this.state.command.pendingApprovals.filter(
            (a) => a.requestId !== e.requestId,
          );
        if (this.state.command.pendingApprovals.length === 0)
          this.state.command.mode = "normal";
        break;
      }
      case "usage.updated": {
        const e = event as {
          inputTokens: number;
          outputTokens: number;
          totalCostUsd?: number;
        };
        const tokens = e.inputTokens + e.outputTokens;
        const cost = e.totalCostUsd ?? 0;
        this.state.metrics.totalTokens += tokens;
        if (e.totalCostUsd !== undefined) {
          this.state.metrics.totalCostUsd =
            (this.state.metrics.totalCostUsd ?? 0) + e.totalCostUsd;
        }
        // Per-agent attribution
        if (this.activeSpeaker) {
          const usage =
            this.activeSpeaker === "proposer"
              ? this.state.metrics.proposerUsage
              : this.state.metrics.challengerUsage;
          usage.tokens += tokens;
          usage.costUsd += cost;
        }
        break;
      }
      case "run.error": {
        const p = this.panel();
        if (!p) break;
        p.error = (event as { message: string }).message;
        p.status = "error";
        break;
      }
      case "run.warning": {
        const p = this.panel();
        if (!p) break;
        p.warnings.push((event as { message: string }).message);
        break;
      }
      case "judge.started": {
        const e = event as { roundNumber: number };
        this.state.judge.visible = true;
        this.state.judge.judgeStatus = "evaluating";
        this.state.judge.roundNumber = e.roundNumber;
        this.state.judge.judgeMessageText = "";
        this.state.judge.verdict = undefined;
        // Also track in judgeResults
        this.state.judgeResults.push({
          roundNumber: e.roundNumber,
          status: "evaluating",
          messageText: "",
        });
        break;
      }
      case "judge.completed": {
        const e = event as {
          roundNumber: number;
          verdict: TuiState["judge"]["verdict"];
        };
        // Stay visible as "done" until next round.started clears it
        this.state.judge.judgeStatus = "done";
        this.state.judge.visible = true;
        this.state.judge.verdict = e.verdict;
        if (e.verdict) this.state.metrics.judgeScore = e.verdict.score;
        // Update the last evaluating judgeResult (handles multiple judges per round)
        const jr = this.activeJudgeResult();
        if (jr) {
          jr.status = "done";
          jr.verdict = e.verdict;
        }
        break;
      }
      case "plan.updated": {
        const p = this.panel();
        if (!p) break;
        const e = event as {
          steps: Array<{
            description: string;
            status: "pending" | "in_progress" | "completed" | "failed";
          }>;
        };
        if (e.steps) {
          p.latestPlan = e.steps.map((step, idx) => ({
            id: `step-${idx}`,
            title: step.description,
            status: step.status,
          }));
        }
        break;
      }
      case "debate.completed": {
        // Clear judge panel on debate end
        this.state.judge.visible = false;
        this.state.judge.judgeStatus = "idle";
        const e = event as { summary?: Record<string, unknown> };
        if (e.summary) {
          this.state.summary = {
            terminationReason: String(e.summary.terminationReason ?? "unknown"),
            roundsCompleted: Number(e.summary.roundsCompleted ?? 0),
            leading: String(e.summary.leading ?? "unknown"),
            judgeScore: e.summary.judgeScore as {
              proposer: number;
              challenger: number;
            } | null,
            recommendedAction: e.summary.recommendedAction
              ? String(e.summary.recommendedAction)
              : null,
            consensus: Array.isArray(e.summary.consensus)
              ? (e.summary.consensus as string[])
              : [],
            unresolved: Array.isArray(e.summary.unresolved)
              ? (e.summary.unresolved as string[])
              : [],
            totalTurns: Number(e.summary.totalTurns ?? 0),
          };
        }
        break;
      }
      default:
        break;
    }
  }
}
