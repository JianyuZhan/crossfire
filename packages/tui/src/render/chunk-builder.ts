import { stripInternalToolBlocks } from "../state/strip-internal.js";
import type {
  CollapsedRoundSummary,
  ContentChunk,
  TuiRound,
  TuiState,
} from "../state/types.js";
import { buildPanelLines, screenLine } from "./line-buffer.js";
import {
  idleBlocks,
  liveStateToBlocks,
  snapshotToBlocks,
} from "./render-blocks.js";

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

function buildCollapsedLines(round: TuiRound): CollapsedRoundSummary {
  const pText = (round.proposer?.messageText ?? "").replace(/\n/g, " ");
  const cText = (round.challenger?.messageText ?? "").replace(/\n/g, " ");
  return { proposerLine: pText, challengerLine: cText };
}

export function rebuildChunks(state: TuiState): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const completedRounds = state.rounds.filter(isCompleted);

  // 1. Completed rounds (each followed by its judge chunk if available)
  for (const round of completedRounds) {
    const collapsed = shouldCollapse(round, state.rounds);

    if (collapsed) {
      chunks.push({
        type: "round",
        roundNumber: round.roundNumber,
        maxRounds: state.metrics.maxRounds,
        active: false,
        collapsed: true,
        collapsedSummary: buildCollapsedLines(round),
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
        maxRounds: state.metrics.maxRounds,
        active: false,
        collapsed: false,
        leftBlocks,
        rightBlocks,
        leftLines: [],
        rightLines: [],
        height: 0,
      });
    }

    // Completed judge result for this round — always shown as separate chunk
    const jr = state.judgeResults.find(
      (j) => j.roundNumber === round.roundNumber && j.status === "done",
    );
    if (jr) {
      const stripped = stripInternalToolBlocks(jr.messageText);
      const judgeLines = stripped
        ? [screenLine([{ text: stripped, style: {} }])]
        : [];
      chunks.push({
        type: "judge",
        roundNumber: round.roundNumber,
        status: "done",
        shouldContinue: jr.verdict?.shouldContinue,
        lines: judgeLines,
      });
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
      maxRounds: state.metrics.maxRounds,
      active: true,
      collapsed: false,
      leftBlocks,
      rightBlocks,
      leftLines: [],
      rightLines: [],
      height: 0,
    });
  }

  // 3. Active judge (skip if already emitted as a completed judgeResult above)
  const alreadyEmittedJudgeRounds = new Set(
    state.judgeResults
      .filter((j) => j.status === "done")
      .map((j) => j.roundNumber),
  );
  if (
    state.judge.visible &&
    state.judge.judgeStatus !== "idle" &&
    !alreadyEmittedJudgeRounds.has(state.judge.roundNumber)
  ) {
    const isDone = state.judge.judgeStatus === "done";
    const stripped = stripInternalToolBlocks(state.judge.judgeMessageText);
    const judgeLines = stripped
      ? [screenLine([{ text: stripped, style: {} }])]
      : !isDone
        ? [
            screenLine([
              {
                text: "Evaluating...",
                style: { color: "yellow", italic: true },
              },
            ]),
          ]
        : [];
    chunks.push({
      type: "judge",
      roundNumber: state.judge.roundNumber,
      status: isDone ? "done" : "streaming",
      shouldContinue: state.judge.verdict?.shouldContinue,
      lines: judgeLines,
    });
  }

  // 4. Final summary
  if (state.summary) {
    const summaryLines = [
      screenLine([
        {
          text: `Terminated: ${state.summary.terminationReason ?? "unknown"} (${state.summary.roundsCompleted} rounds)`,
          style: {},
        },
      ]),
    ];
    if (state.summary.recommendedAction) {
      summaryLines.push(
        screenLine([
          {
            text: `Decision: ${state.summary.recommendedAction}`,
            style: { bold: true },
          },
        ]),
      );
    }
    chunks.push({ type: "summary", lines: summaryLines });
  }

  return chunks;
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
