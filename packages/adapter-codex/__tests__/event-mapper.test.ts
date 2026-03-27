import { describe, expect, it } from "vitest";
import { mapCodexNotification } from "../src/event-mapper.js";

const CTX = {
	adapterId: "codex" as const,
	adapterSessionId: "s1",
	turnId: "t1",
};

describe("mapCodexNotification", () => {
	it("maps item/agentMessage/delta to message.delta", () => {
		const events = mapCodexNotification(
			"item/agentMessage/delta",
			{ text: "Hello" },
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("message.delta");
		if (events[0].kind === "message.delta") {
			expect(events[0].text).toBe("Hello");
			expect(events[0].role).toBe("assistant");
		}
	});

	it("maps item/reasoning/summaryTextDelta to thinking.delta", () => {
		const events = mapCodexNotification(
			"item/reasoning/summaryTextDelta",
			{ text: "Thinking..." },
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("thinking.delta");
		if (events[0].kind === "thinking.delta") {
			expect(events[0].text).toBe("Thinking...");
			expect(events[0].thinkingType).toBe("reasoning-summary");
		}
	});

	it("maps item/completed (agentMessage) to message.final", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				type: "agentMessage",
				text: "Full message",
				phase: "completed",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("message.final");
		if (events[0].kind === "message.final") {
			expect(events[0].text).toBe("Full message");
			expect(events[0].stopReason).toBe("completed");
		}
	});

	it("maps item/started (commandExecution) to tool.call with toolName 'shell'", () => {
		const events = mapCodexNotification(
			"item/started",
			{
				type: "commandExecution",
				id: "cmd1",
				command: "ls -la",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.call");
		if (events[0].kind === "tool.call") {
			expect(events[0].toolName).toBe("shell");
			expect(events[0].toolUseId).toBe("cmd1");
		}
	});

	it("maps item/started (fileChange) to tool.call with toolName 'file_edit'", () => {
		const events = mapCodexNotification(
			"item/started",
			{
				type: "fileChange",
				id: "fc1",
				path: "/some/file.ts",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.call");
		if (events[0].kind === "tool.call") {
			expect(events[0].toolName).toBe("file_edit");
			expect(events[0].toolUseId).toBe("fc1");
		}
	});

	it("maps item/completed (commandExecution) to tool.result", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				type: "commandExecution",
				id: "cmd1",
				exitCode: 0,
				output: "success",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.result");
		if (events[0].kind === "tool.result") {
			expect(events[0].toolUseId).toBe("cmd1");
			expect(events[0].toolName).toBe("shell");
			expect(events[0].success).toBe(true);
		}
	});

	it("maps item/completed (commandExecution) with non-zero exit to tool.result failure", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				type: "commandExecution",
				id: "cmd1",
				exitCode: 1,
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		if (events[0].kind === "tool.result") {
			expect(events[0].success).toBe(false);
		}
	});

	it("maps item/completed (fileChange) to tool.result", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				type: "fileChange",
				id: "fc1",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		if (events[0].kind === "tool.result") {
			expect(events[0].toolName).toBe("file_edit");
			expect(events[0].toolUseId).toBe("fc1");
			expect(events[0].success).toBe(true);
		}
	});

	it("maps turn/plan/updated to plan.updated with field renaming", () => {
		const events = mapCodexNotification(
			"turn/plan/updated",
			{
				steps: [
					{ step: "Analyze code", status: "completed" },
					{ step: "Write tests", status: "inProgress" },
					{ step: "Implement", status: "pending" },
				],
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("plan.updated");
		if (events[0].kind === "plan.updated") {
			expect(events[0].steps).toEqual([
				{ description: "Analyze code", status: "completed" },
				{ description: "Write tests", status: "in_progress" },
				{ description: "Implement", status: "pending" },
			]);
		}
	});

	it("maps turn/completed to turn.completed", () => {
		const events = mapCodexNotification(
			"turn/completed",
			{
				status: "completed",
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("turn.completed");
		if (events[0].kind === "turn.completed") {
			expect(events[0].status).toBe("completed");
		}
	});

	it("maps thread/tokenUsage/updated to usage.updated", () => {
		const events = mapCodexNotification(
			"thread/tokenUsage/updated",
			{
				inputTokens: 100,
				outputTokens: 50,
				totalCostUsd: 0.02,
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("usage.updated");
		if (events[0].kind === "usage.updated") {
			expect(events[0].inputTokens).toBe(100);
			expect(events[0].outputTokens).toBe(50);
			expect(events[0].totalCostUsd).toBe(0.02);
		}
	});

	it("suppresses item/commandExecution/outputDelta", () => {
		const events = mapCodexNotification(
			"item/commandExecution/outputDelta",
			{ text: "output" },
			CTX,
		);
		expect(events).toHaveLength(0);
	});

	it("suppresses item/fileChange/outputDelta", () => {
		const events = mapCodexNotification(
			"item/fileChange/outputDelta",
			{ text: "diff" },
			CTX,
		);
		expect(events).toHaveLength(0);
	});

	it("returns empty for unknown methods", () => {
		const events = mapCodexNotification("unknown/method", {}, CTX);
		expect(events).toHaveLength(0);
	});

	// --- Meta-tool detection tests ---

	it("maps item/started with debate_meta command to tool.call with toolName 'debate_meta'", () => {
		const events = mapCodexNotification(
			"item/started",
			{
				item: {
					type: "commandExecution",
					id: "call_abc",
					command: '/bin/zsh -lc "debate_meta \'{\\"stance\\":\\"agree\\"}\'"',
				},
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.call");
		if (events[0].kind === "tool.call") {
			expect(events[0].toolName).toBe("debate_meta");
			expect(events[0].toolUseId).toBe("call_abc");
		}
	});

	it("maps item/started with judge_verdict command to tool.call with toolName 'judge_verdict'", () => {
		const events = mapCodexNotification(
			"item/started",
			{
				item: {
					type: "commandExecution",
					id: "call_jv1",
					command: "/bin/zsh -lc \"judge_verdict '...'\"",
				},
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		if (events[0].kind === "tool.call") {
			expect(events[0].toolName).toBe("judge_verdict");
		}
	});

	it("maps item/completed with debate_meta to tool.call (parsed JSON) + tool.result", () => {
		const metaJson = JSON.stringify({
			stance: "agree",
			confidence: 0.8,
			key_points: ["point 1"],
			concessions: [],
		});
		const events = mapCodexNotification(
			"item/completed",
			{
				item: {
					type: "commandExecution",
					id: "call_abc",
					command: "/bin/zsh -lc debate_meta",
					aggregatedOutput: `${metaJson}\n`,
					exitCode: 0,
				},
			},
			CTX,
		);
		// Should emit: tool.call (with parsed input) + tool.result
		expect(events).toHaveLength(2);
		expect(events[0].kind).toBe("tool.call");
		if (events[0].kind === "tool.call") {
			expect(events[0].toolName).toBe("debate_meta");
			expect((events[0].input as Record<string, unknown>).stance).toBe("agree");
		}
		expect(events[1].kind).toBe("tool.result");
		if (events[1].kind === "tool.result") {
			expect(events[1].toolName).toBe("debate_meta");
			expect(events[1].success).toBe(true);
		}
	});

	it("maps failed debate_meta to tool.result only (no parsed tool.call)", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				item: {
					type: "commandExecution",
					id: "call_fail",
					command: "/bin/zsh -lc debate_meta",
					aggregatedOutput: "command not found: debate_meta\n",
					exitCode: 127,
				},
			},
			CTX,
		);
		// Failed: only tool.result, no extra tool.call
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.result");
		if (events[0].kind === "tool.result") {
			expect(events[0].toolName).toBe("debate_meta");
			expect(events[0].success).toBe(false);
		}
	});

	it("regular shell command is not affected by meta-tool detection", () => {
		const events = mapCodexNotification(
			"item/completed",
			{
				item: {
					type: "commandExecution",
					id: "cmd_ls",
					command: "/bin/zsh -lc ls",
					aggregatedOutput: "file1\nfile2\n",
					exitCode: 0,
				},
			},
			CTX,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.result");
		if (events[0].kind === "tool.result") {
			expect(events[0].toolName).toBe("shell");
		}
	});
});
