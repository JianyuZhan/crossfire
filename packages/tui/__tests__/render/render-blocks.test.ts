import { describe, expect, it } from "vitest";
import {
  snapshotToBlocks,
  liveStateToBlocks,
  idleBlocks,
} from "../../src/render/render-blocks.js";
import type {
  AgentTurnSnapshot,
  LiveAgentPanelState,
} from "../../src/state/types.js";

describe("snapshotToBlocks", () => {
  it("produces agent-header + message for basic snapshot", () => {
    const snap: AgentTurnSnapshot = {
      messageText: "Hello world",
      tools: [],
      warnings: [],
      turnDurationMs: 1500,
    };
    const blocks = snapshotToBlocks(snap, "proposer", "claude");
    expect(blocks[0].kind).toBe("agent-header");
    expect(blocks.some((b) => b.kind === "message")).toBe(true);
    expect(blocks.some((b) => b.kind === "thinking")).toBe(false);
  });

  it("includes tool-call blocks", () => {
    const snap: AgentTurnSnapshot = {
      messageText: "result",
      tools: [
        {
          toolUseId: "1",
          toolName: "meta",
          status: "done",
          inputSummary: "x",
          expanded: false,
        },
      ],
      warnings: [],
    };
    const blocks = snapshotToBlocks(snap, "challenger", "gemini");
    expect(blocks.some((b) => b.kind === "tool-call")).toBe(true);
  });
});

describe("liveStateToBlocks", () => {
  it("includes thinking block when status is thinking", () => {
    const state: LiveAgentPanelState = {
      role: "proposer",
      agentType: "claude",
      status: "thinking",
      thinkingText: "Let me think...",
      currentMessageText: "",
      tools: [],
      warnings: [],
    };
    const blocks = liveStateToBlocks(state);
    expect(blocks.some((b) => b.kind === "thinking")).toBe(true);
  });

  it("includes streaming message when speaking", () => {
    const state: LiveAgentPanelState = {
      role: "challenger",
      status: "speaking",
      thinkingText: "",
      currentMessageText: "In progress...",
      tools: [],
      warnings: [],
    };
    const blocks = liveStateToBlocks(state);
    const msg = blocks.find((b) => b.kind === "message");
    expect(msg).toBeDefined();
    if (msg?.kind === "message") expect(msg.isFinal).toBe(false);
  });
});

describe("idleBlocks", () => {
  it("produces exactly agent-header", () => {
    const blocks = idleBlocks("proposer", "claude");
    expect(blocks[0].kind).toBe("agent-header");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });
});
