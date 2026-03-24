import { describe, expect, it } from "vitest";
import {
  shouldCollapse,
  rebuildChunks,
} from "../../src/render/chunk-builder.js";
import type { TuiState, TuiRound } from "../../src/state/types.js";

describe("shouldCollapse", () => {
  it("returns false when no newer round exists", () => {
    const round: TuiRound = {
      roundNumber: 1,
      proposer: {} as any,
      challenger: {} as any,
    };
    const rounds = [round];
    expect(shouldCollapse(round, rounds)).toBe(false);
  });

  it("returns true when newer round exists", () => {
    const round: TuiRound = {
      roundNumber: 1,
      proposer: {} as any,
      challenger: {} as any,
    };
    const rounds = [round, { roundNumber: 2 } as TuiRound];
    expect(shouldCollapse(round, rounds)).toBe(true);
  });

  it("respects userCollapsed=false override", () => {
    const round: TuiRound = {
      roundNumber: 1,
      proposer: {} as any,
      challenger: {} as any,
      userCollapsed: false,
    };
    const rounds = [round, { roundNumber: 2 } as TuiRound];
    expect(shouldCollapse(round, rounds)).toBe(false);
  });

  it("respects userCollapsed=true override", () => {
    const round: TuiRound = {
      roundNumber: 1,
      proposer: {} as any,
      challenger: {} as any,
      userCollapsed: true,
    };
    const rounds = [round];
    expect(shouldCollapse(round, rounds)).toBe(true);
  });
});

describe("rebuildChunks", () => {
  it("produces empty array for empty state", () => {
    const state = makeMinimalState();
    const chunks = rebuildChunks(state);
    expect(chunks).toHaveLength(0);
  });

  it("produces round chunk for completed round", () => {
    const state = makeMinimalState();
    state.rounds = [
      {
        roundNumber: 1,
        proposer: { messageText: "Hello", tools: [], warnings: [] },
        challenger: { messageText: "World", tools: [], warnings: [] },
      } as any,
    ];
    const chunks = rebuildChunks(state);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].type).toBe("round");
  });

  it("produces judge chunk after round with judge result", () => {
    const state = makeMinimalState();
    state.rounds = [
      {
        roundNumber: 1,
        proposer: { messageText: "Hello", tools: [], warnings: [] },
        challenger: { messageText: "World", tools: [], warnings: [] },
      } as any,
    ];
    state.judgeResults = [
      {
        roundNumber: 1,
        status: "done",
        messageText: "Judge says...",
      },
    ];
    const chunks = rebuildChunks(state);
    const judgeChunk = chunks.find((c) => c.type === "judge");
    expect(judgeChunk).toBeDefined();
  });

  it("produces summary chunk when summary exists", () => {
    const state = makeMinimalState();
    state.summary = {
      terminationReason: "max_rounds",
      roundsCompleted: 3,
      leading: "proposer",
      judgeScore: null,
      recommendedAction: null,
      consensus: [],
      unresolved: [],
      totalTurns: 6,
    };
    const chunks = rebuildChunks(state);
    const summaryChunk = chunks.find((c) => c.type === "summary");
    expect(summaryChunk).toBeDefined();
  });
});

function makeMinimalState(): TuiState {
  return {
    proposer: {
      role: "proposer",
      status: "idle",
      thinkingText: "",
      currentMessageText: "",
      tools: [],
      warnings: [],
    },
    challenger: {
      role: "challenger",
      status: "idle",
      thinkingText: "",
      currentMessageText: "",
      tools: [],
      warnings: [],
    },
    rounds: [],
    judgeResults: [],
    judge: {
      visible: false,
      roundNumber: 0,
      judgeStatus: "idle",
      judgeMessageText: "",
    },
    metrics: { currentRound: 0, maxRounds: 3, debateId: "test" } as any,
    command: { mode: "normal", pendingApprovals: [] },
    debateState: { phase: "not_started", config: { topic: "test" } } as any,
  };
}
