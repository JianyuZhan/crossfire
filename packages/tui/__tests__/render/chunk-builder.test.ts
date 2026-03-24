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

  it("embeds judge result in round chunk instead of separate judge chunk", () => {
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
    expect(judgeChunk).toBeUndefined();
    const roundChunk = chunks[0];
    expect(roundChunk.type).toBe("round");
    if (roundChunk.type === "round") {
      expect(roundChunk.judgeResult).toBeDefined();
    }
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

describe("rebuildChunks — collapsed round summary", () => {
  it("collapsed round has structured CollapsedRoundSummary with P and C lines", () => {
    const state = makeMinimalState();
    state.rounds = [
      {
        roundNumber: 1,
        proposer: {
          messageText: "Proposer argument text here",
          tools: [],
          warnings: [],
        },
        challenger: {
          messageText: "Challenger rebuttal text",
          tools: [],
          warnings: [],
        },
      } as any,
      {
        roundNumber: 2,
        proposer: { messageText: "P2", tools: [], warnings: [] },
      } as any,
    ];
    const chunks = rebuildChunks(state);
    const collapsed = chunks.find((c) => c.type === "round" && c.collapsed);
    expect(collapsed).toBeDefined();
    if (collapsed?.type === "round") {
      expect(collapsed.collapsedSummary).toBeDefined();
      expect(collapsed.collapsedSummary!.proposerLine).toContain(
        "Proposer argument",
      );
      expect(collapsed.collapsedSummary!.challengerLine).toContain(
        "Challenger rebuttal",
      );
      expect(collapsed.collapsedSummary!.judgeLine).toBeUndefined();
    }
  });

  it("collapsed round includes judge line when judgeResult exists", () => {
    const state = makeMinimalState();
    state.rounds = [
      {
        roundNumber: 1,
        proposer: { messageText: "P text", tools: [], warnings: [] },
        challenger: { messageText: "C text", tools: [], warnings: [] },
      } as any,
      {
        roundNumber: 2,
        proposer: { messageText: "P2", tools: [], warnings: [] },
      } as any,
    ];
    state.judgeResults = [
      {
        roundNumber: 1,
        status: "done" as const,
        messageText: "Both made good points.",
        verdict: {
          leading: "proposer",
          score: { proposer: 7, challenger: 5 },
          reasoning: "Proposer had stronger evidence",
          shouldContinue: true,
        },
      },
    ];
    const chunks = rebuildChunks(state);
    const collapsed = chunks.find((c) => c.type === "round" && c.collapsed);
    if (collapsed?.type === "round") {
      expect(collapsed.collapsedSummary!.judgeLine).toBeDefined();
      expect(collapsed.collapsedSummary!.judgeLine).toContain("Continue");
      expect(collapsed.collapsedSummary!.judgeLine).toContain("7");
    }
  });
});

describe("rebuildChunks — embedded judge in expanded rounds", () => {
  it("expanded round embeds judgeResult instead of separate judge chunk", () => {
    const state = makeMinimalState();
    state.rounds = [
      {
        roundNumber: 1,
        proposer: { messageText: "P text", tools: [], warnings: [] },
        challenger: { messageText: "C text", tools: [], warnings: [] },
      } as any,
    ];
    state.judgeResults = [
      {
        roundNumber: 1,
        status: "done" as const,
        messageText: "Both made good points.",
        verdict: {
          leading: "proposer",
          score: { proposer: 7, challenger: 5 },
          reasoning: "Proposer had stronger evidence",
          shouldContinue: true,
        },
      },
    ];
    const chunks = rebuildChunks(state);
    const judgeChunks = chunks.filter((c) => c.type === "judge");
    expect(judgeChunks).toHaveLength(0);
    const roundChunk = chunks.find((c) => c.type === "round");
    if (roundChunk?.type === "round") {
      expect(roundChunk.judgeResult).toBeDefined();
      expect(roundChunk.judgeResult!.verdict?.leading).toBe("proposer");
    }
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
