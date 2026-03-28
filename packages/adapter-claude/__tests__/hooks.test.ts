import type { NormalizedEvent } from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import { buildHooks } from "../src/hooks.js";

const CTX = {
	adapterId: "claude" as const,
	adapterSessionId: "s1",
};

const DUMMY_SIGNAL = new AbortController().signal;

/** Helper: invoke the first hook callback in a matcher */
// biome-ignore lint: test helper with loose types
async function callHook(
	matcher: { hooks: Array<any> },
	input: Record<string, unknown>,
	toolUseID?: string,
) {
	return matcher.hooks[0](input, toolUseID, { signal: DUMMY_SIGNAL });
}

describe("buildHooks", () => {
	it("returns object with expected hook keys", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		expect(hooks).toHaveProperty("PreToolUse");
		expect(hooks).toHaveProperty("PostToolUse");
		expect(hooks).toHaveProperty("PostToolUseFailure");
		expect(hooks).toHaveProperty("SubagentStart");
		expect(hooks).toHaveProperty("SubagentStop");
	});

	it("each hook value is an array of matchers with a hooks array", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		for (const key of [
			"PreToolUse",
			"PostToolUse",
			"PostToolUseFailure",
			"SubagentStart",
			"SubagentStop",
		]) {
			const arr = hooks[key];
			expect(Array.isArray(arr)).toBe(true);
			expect(arr.length).toBeGreaterThan(0);
			expect(Array.isArray(arr[0].hooks)).toBe(true);
			expect(typeof arr[0].hooks[0]).toBe("function");
		}
	});

	it("PreToolUse hook emits tool.call event", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const result = await callHook(
			hooks.PreToolUse[0],
			{
				tool_name: "bash",
				tool_use_id: "tu1",
				tool_input: { command: "ls" },
			},
			"tu1",
		);
		expect(result).toEqual({ continue: true });
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("tool.call");
		if (event.kind === "tool.call") {
			expect(event.toolName).toBe("bash");
			expect(event.toolUseId).toBe("tu1");
			expect(event.input).toEqual({ command: "ls" });
			expect(event.adapterId).toBe("claude");
			expect(event.adapterSessionId).toBe("s1");
			expect(event.turnId).toBe("t1");
		}
	});

	it("PostToolUse hook emits tool.result with success=true", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(
			hooks.PostToolUse[0],
			{
				tool_name: "bash",
				tool_use_id: "tu1",
				tool_response: "file.txt",
			},
			"tu1",
		);
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("tool.result");
		if (event.kind === "tool.result") {
			expect(event.toolName).toBe("bash");
			expect(event.toolUseId).toBe("tu1");
			expect(event.success).toBe(true);
			expect(event.output).toBe("file.txt");
		}
	});

	it("PostToolUseFailure hook emits tool.result with success=false", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(
			hooks.PostToolUseFailure[0],
			{
				tool_name: "bash",
				tool_use_id: "tu1",
				error: "Permission denied",
			},
			"tu1",
		);
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("tool.result");
		if (event.kind === "tool.result") {
			expect(event.toolName).toBe("bash");
			expect(event.toolUseId).toBe("tu1");
			expect(event.success).toBe(false);
			expect(event.error).toBe("Permission denied");
		}
	});

	it("SubagentStart hook emits subagent.started", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(hooks.SubagentStart[0], {
			agent_id: "sa1",
			agent_type: "Research task",
		});
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("subagent.started");
		if (event.kind === "subagent.started") {
			expect(event.subagentId).toBe("sa1");
			expect(event.description).toBe("Research task");
		}
	});

	it("SubagentStop hook emits subagent.completed", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(hooks.SubagentStop[0], {
			agent_id: "sa1",
		});
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("subagent.completed");
		if (event.kind === "subagent.completed") {
			expect(event.subagentId).toBe("sa1");
		}
	});

	it("uses current turnId from getter", async () => {
		const emit = vi.fn();
		let turnId = "t1";
		const hooks = buildHooks(emit, CTX, () => turnId);

		await callHook(
			hooks.PreToolUse[0],
			{ tool_name: "bash", tool_use_id: "tu1", tool_input: {} },
			"tu1",
		);
		expect(emit.mock.calls[0][0].turnId).toBe("t1");

		turnId = "t2";
		await callHook(
			hooks.PreToolUse[0],
			{ tool_name: "read", tool_use_id: "tu2", tool_input: {} },
			"tu2",
		);
		expect(emit.mock.calls[1][0].turnId).toBe("t2");
	});

	it("timestamp is populated on emitted events", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(
			hooks.PreToolUse[0],
			{ tool_name: "bash", tool_use_id: "tu1", tool_input: {} },
			"tu1",
		);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.timestamp).toBeGreaterThan(0);
	});

	it("toolUseID from second argument takes priority", async () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		await callHook(
			hooks.PreToolUse[0],
			{ tool_name: "bash", tool_use_id: "from-input", tool_input: {} },
			"from-arg",
		);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		if (event.kind === "tool.call") {
			expect(event.toolUseId).toBe("from-arg");
		}
	});
});
