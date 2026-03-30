import { describe, expect, it } from "vitest";
import {
	idleBlocks,
	liveStateToBlocks,
	snapshotToBlocks,
} from "../../src/render/render-blocks.js";
import type {
	AgentTurnSnapshot,
	LiveAgentPanelState,
} from "../../src/state/types.js";

describe("snapshotToBlocks", () => {
	it("produces agent-header + message for basic snapshot", () => {
		const snap: AgentTurnSnapshot = {
			messageText: "Hello world",
			narrationTexts: [],
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
			narrationTexts: [],
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
			narrationTexts: [],
			currentMessageText: "",
			tools: [],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		expect(blocks.some((b) => b.kind === "thinking")).toBe(true);
	});

	it("keeps thinking visible after speaking starts", () => {
		const state: LiveAgentPanelState = {
			role: "proposer",
			agentType: "codex",
			status: "speaking",
			thinkingText: "First reason about the repo shape",
			narrationTexts: [],
			currentMessageText: "Here is the answer...",
			tools: [],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		expect(blocks.some((b) => b.kind === "thinking")).toBe(true);
		expect(blocks.some((b) => b.kind === "message")).toBe(true);
	});

	it("includes plan and subagent blocks when present", () => {
		const state = {
			role: "challenger",
			status: "tool",
			thinkingText: "",
			narrationTexts: [],
			currentMessageText: "",
			tools: [],
			warnings: [],
			latestPlan: [
				{ id: "step-1", title: "Inspect files", status: "in_progress" },
			],
			subagents: [
				{
					subagentId: "sa-1",
					description: "Research the test failure",
					status: "running",
				},
			],
		} as unknown as LiveAgentPanelState;
		const blocks = liveStateToBlocks(state);
		expect(blocks.some((b) => b.kind === "plan")).toBe(true);
		expect(
			blocks.some((block) => (block as { kind: string }).kind === "subagent"),
		).toBe(true);
	});

	it("includes streaming message when speaking", () => {
		const state: LiveAgentPanelState = {
			role: "challenger",
			status: "speaking",
			thinkingText: "",
			narrationTexts: [],
			currentMessageText: "In progress...",
			tools: [],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		const msg = blocks.find((b) => b.kind === "message");
		expect(msg).toBeDefined();
		if (msg?.kind === "message") expect(msg.isFinal).toBe(false);
	});

	it("keeps narration blocks visible while tools are running", () => {
		const state: LiveAgentPanelState = {
			role: "proposer",
			status: "tool",
			thinkingText: "",
			narrationTexts: ["Let me verify a few sources first."],
			currentMessageText: "",
			tools: [],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		const msg = blocks.find((b) => b.kind === "message");
		expect(msg).toBeDefined();
		if (msg?.kind === "message") {
			expect(msg.text).toBe("Let me verify a few sources first.");
			expect(msg.isFinal).toBe(false);
		}
	});

	it("adds tool progress counts to the live header label", () => {
		const state: LiveAgentPanelState = {
			role: "proposer",
			status: "tool",
			thinkingText: "",
			narrationTexts: [],
			currentMessageText: "",
			tools: [
				{
					toolUseId: "t1",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "running",
					expanded: true,
				},
				{
					toolUseId: "t2",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "done",
					expanded: true,
				},
				{
					toolUseId: "t3",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "error",
					expanded: true,
				},
			],
			warnings: [],
		};
		const header = liveStateToBlocks(state)[0];
		expect(header.kind).toBe("agent-header");
		if (header.kind === "agent-header") {
			expect(header.statusLabel).toContain("1 running");
			expect(header.statusLabel).toContain("1 done");
			expect(header.statusLabel).toContain("1 error");
		}
	});
});

describe("idleBlocks", () => {
	it("produces exactly agent-header", () => {
		const blocks = idleBlocks("proposer", "claude");
		expect(blocks[0].kind).toBe("agent-header");
		expect(blocks.length).toBeGreaterThanOrEqual(1);
	});
});
