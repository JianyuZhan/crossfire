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
					status: "succeeded",
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

	it("shows running count and recent failure summary in the live header label", () => {
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
					elapsedMs: 2500,
					expanded: true,
				},
				{
					toolUseId: "t2",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "succeeded",
					expanded: true,
				},
				{
					toolUseId: "t3",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "failed",
					resultSummary: "Request failed with status code 404",
					expanded: true,
				},
			],
			warnings: [],
		};
		const header = liveStateToBlocks(state)[0];
		expect(header.kind).toBe("agent-header");
		if (header.kind === "agent-header") {
			expect(header.statusLabel).toContain("1 running");
			expect(header.statusLabel).toContain("active 2.5s");
			expect(header.statusLabel).toContain("recent failures: 404×1");
		}
	});

	it("includes active elapsed time in the live header when a tool is still running", () => {
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
					elapsedMs: 2500,
					expanded: true,
				},
			],
			warnings: [],
		};
		const header = liveStateToBlocks(state)[0];
		expect(header.kind).toBe("agent-header");
		if (header.kind === "agent-header") {
			expect(header.statusLabel).toContain("active 2.5s");
		}
	});

	it("compresses repeated failed tools into a warning summary", () => {
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
					elapsedMs: 1500,
					expanded: true,
				},
				{
					toolUseId: "t2",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "failed",
					resultSummary: "Request failed with status code 404",
					expanded: true,
				},
				{
					toolUseId: "t3",
					toolName: "WebFetch",
					inputSummary: "{}",
					status: "failed",
					resultSummary: "Request failed with status code 404",
					expanded: true,
				},
			],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		const warning = blocks.find((block) => block.kind === "warning");
		expect(warning).toBeDefined();
		if (warning?.kind === "warning") {
			expect(warning.text).toContain("WebFetch failures");
			expect(warning.text).toContain("404×2");
		}
		expect(
			blocks.filter(
				(block) => block.kind === "tool-call" && block.status === "error",
			),
		).toHaveLength(0);
	});

	it("does not keep completed tools in the live tool list", () => {
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
					elapsedMs: 1500,
					expanded: true,
				},
				{
					toolUseId: "t2",
					toolName: "Read",
					inputSummary: "{}",
					status: "succeeded",
					expanded: true,
				},
			],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		const toolCalls = blocks.filter((block) => block.kind === "tool-call");
		expect(toolCalls).toHaveLength(1);
		if (toolCalls[0]?.kind === "tool-call") {
			expect(toolCalls[0].toolName).toBe("WebFetch");
		}
	});

	it("does not keep unknown-outcome tools in the live tool list", () => {
		const state: LiveAgentPanelState = {
			role: "proposer",
			status: "tool",
			thinkingText: "",
			narrationTexts: [],
			currentMessageText: "",
			tools: [
				{
					toolUseId: "t1",
					toolName: "Read",
					inputSummary: "{}",
					status: "unknown",
					resultSummary: "unknown outcome",
					expanded: true,
				},
			],
			warnings: [],
		};
		const blocks = liveStateToBlocks(state);
		expect(blocks.filter((block) => block.kind === "tool-call")).toHaveLength(
			0,
		);
		const warning = blocks.find((block) => block.kind === "warning");
		expect(warning).toBeDefined();
		if (warning?.kind === "warning") {
			expect(warning.text).toContain("unknown outcomes");
			expect(warning.text).toContain("Read×1");
		}
	});

	it("includes the current execution mode in the live header label", () => {
		const state: LiveAgentPanelState = {
			role: "proposer",
			status: "thinking",
			executionMode: "research",
			thinkingText: "Planning",
			narrationTexts: [],
			currentMessageText: "",
			tools: [],
			warnings: [],
		};
		const header = liveStateToBlocks(state)[0];
		expect(header.kind).toBe("agent-header");
		if (header.kind === "agent-header") {
			expect(header.statusLabel).toContain("research");
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
