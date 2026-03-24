import {
  snapshotToBlocks,
  liveStateToBlocks,
  idleBlocks,
} from "./render-blocks.js";
import { buildPanelLines, screenLine } from "./line-buffer.js";
import type {
  TuiState,
  TuiRound,
  ContentChunk,
  JudgeRenderChunk,
  JudgeRoundResult,
} from "../state/types.js";

export function shouldCollapse(
  round: TuiRound,
  allRounds: TuiRound[],
): boolean {
  if (round.userCollapsed !== undefined) return round.userCollapsed;
  return allRounds.some((r) => r.roundNumber > round.roundNumber);
}

function isCompleted(round: TuiRound): boolean {
  return !!round.proposer && !!round.challenger;
}

function findActiveRound(state: TuiState): TuiRound | undefined {
  if (state.rounds.length === 0) return undefined;
  const last = state.rounds[state.rounds.length - 1];
  if (!last.proposer || !last.challenger) return last;
  return undefined;
}

function buildCollapsedSummary(round: TuiRound): string {
  const pText = round.proposer?.messageText ?? "";
  const cText = round.challenger?.messageText ?? "";
  const p = pText.slice(0, 60).replace(/\n/g, " ");
  const c = cText.slice(0, 60).replace(/\n/g, " ");
  return `P: ${p}... | C: ${c}...`;
}

export function rebuildChunks(state: TuiState): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const completedRounds = state.rounds.filter(isCompleted);

  // 1. Completed rounds
  for (const round of completedRounds) {
    const collapsed = shouldCollapse(round, state.rounds);
    if (collapsed) {
      chunks.push({
        type: "round",
        roundNumber: round.roundNumber,
        collapsed: true,
        collapsedSummary: buildCollapsedSummary(round),
        leftLines: [],
        rightLines: [],
        height: 0,
      });
    } else {
      const leftBlocks = snapshotToBlocks(
        round.proposer!,
        "proposer",
        state.proposer.agentType,
      );
      const rightBlocks = snapshotToBlocks(
        round.challenger!,
        "challenger",
        state.challenger.agentType,
      );
      chunks.push({
        type: "round",
        roundNumber: round.roundNumber,
        collapsed: false,
        leftBlocks,
        rightBlocks,
        leftLines: [], // Populated by caller with populateChunkLines
        rightLines: [],
        height: 0,
      });
    }

    // Judge results for this round
    for (const jr of state.judgeResults.filter(
      (j) => j.roundNumber === round.roundNumber && j.status === "done",
    )) {
      chunks.push(buildJudgeChunk(jr));
    }
  }

  // 2. Active round
  const active = findActiveRound(state);
  if (active) {
    const leftBlocks = active.proposer
      ? snapshotToBlocks(active.proposer, "proposer", state.proposer.agentType)
      : liveStateToBlocks(state.proposer);
    const rightBlocks = active.challenger
      ? snapshotToBlocks(
          active.challenger,
          "challenger",
          state.challenger.agentType,
        )
      : active.proposer
        ? liveStateToBlocks(state.challenger)
        : idleBlocks("challenger", state.challenger.agentType);

    chunks.push({
      type: "round",
      roundNumber: active.roundNumber,
      collapsed: false,
      leftBlocks,
      rightBlocks,
      leftLines: [],
      rightLines: [],
      height: 0,
    });
  }

  // 3. Active judge
  if (state.judge.visible && state.judge.judgeStatus !== "idle") {
    chunks.push({
      type: "judge",
      roundNumber: state.judge.roundNumber,
      status: state.judge.judgeStatus === "done" ? "done" : "streaming",
      lines: state.judge.judgeMessageText
        ? [screenLine([{ text: state.judge.judgeMessageText, style: {} }])]
        : [],
    });
  }

  // 4. Final summary
  if (state.summary) {
    const summaryLines = [
      screenLine([
        {
          text: `Leading: ${state.summary.leading ?? "undecided"}`,
          style: { bold: true },
        },
      ]),
      screenLine([
        {
          text: `Terminated: ${state.summary.terminationReason ?? "unknown"} (${state.summary.roundsCompleted} rounds)`,
          style: {},
        },
      ]),
    ];
    chunks.push({ type: "summary", lines: summaryLines });
  }

  return chunks;
}

function buildJudgeChunk(jr: JudgeRoundResult): JudgeRenderChunk {
  const lines = [];
  if (jr.messageText) {
    lines.push(screenLine([{ text: jr.messageText, style: {} }]));
  }
  if (jr.verdict) {
    lines.push(
      screenLine([
        {
          text: `Verdict: leading=${jr.verdict.leading}`,
          style: { bold: true },
        },
      ]),
    );
  }
  return {
    type: "judge",
    roundNumber: jr.roundNumber,
    status: "done",
    lines,
  };
}

/**
 * Populate leftLines/rightLines and height on RoundRenderChunks.
 * Called after rebuildChunks, before buildGlobalLineBuffer.
 */
export function populateChunkLines(
  chunks: ContentChunk[],
  panelWidth: number,
): void {
  for (const chunk of chunks) {
    if (
      chunk.type === "round" &&
      !chunk.collapsed &&
      chunk.leftBlocks &&
      chunk.rightBlocks
    ) {
      chunk.leftLines = buildPanelLines(chunk.leftBlocks, panelWidth);
      chunk.rightLines = buildPanelLines(chunk.rightBlocks, panelWidth);
      chunk.height = Math.max(chunk.leftLines.length, chunk.rightLines.length);
    }
  }
}
