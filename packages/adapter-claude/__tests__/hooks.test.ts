import type { NormalizedEvent } from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import { buildHooks } from "../src/hooks.js";

const CTX = {
	adapterId: "claude" as const,
	adapterSessionId: "s1",
};

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

	it("each hook value is an array of matchers with a callback", () => {
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
			expect(typeof arr[0].callback).toBe("function");
		}
	});

	it("PreToolUse callback emits tool.call event", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const cb = hooks.PreToolUse[0].callback;
		cb({
			tool_name: "bash",
			tool_use_id: "tu1",
			tool_input: { command: "ls" },
		});
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

	it("PostToolUse callback emits tool.result with success=true", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const cb = hooks.PostToolUse[0].callback;
		cb({
			tool_name: "bash",
			tool_use_id: "tu1",
			tool_output: "file.txt",
		});
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

	it("PostToolUseFailure callback emits tool.result with success=false", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const cb = hooks.PostToolUseFailure[0].callback;
		cb({
			tool_name: "bash",
			tool_use_id: "tu1",
			error: "Permission denied",
		});
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

	it("SubagentStart callback emits subagent.started", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const cb = hooks.SubagentStart[0].callback;
		cb({
			subagent_id: "sa1",
			description: "Research task",
		});
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("subagent.started");
		if (event.kind === "subagent.started") {
			expect(event.subagentId).toBe("sa1");
			expect(event.description).toBe("Research task");
		}
	});

	it("SubagentStop callback emits subagent.completed", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		const cb = hooks.SubagentStop[0].callback;
		cb({
			subagent_id: "sa1",
		});
		expect(emit).toHaveBeenCalledTimes(1);
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.kind).toBe("subagent.completed");
		if (event.kind === "subagent.completed") {
			expect(event.subagentId).toBe("sa1");
		}
	});

	it("uses current turnId from getter", () => {
		const emit = vi.fn();
		let turnId = "t1";
		const hooks = buildHooks(emit, CTX, () => turnId);

		hooks.PreToolUse[0].callback({
			tool_name: "bash",
			tool_use_id: "tu1",
			tool_input: {},
		});
		expect(emit.mock.calls[0][0].turnId).toBe("t1");

		turnId = "t2";
		hooks.PreToolUse[0].callback({
			tool_name: "read",
			tool_use_id: "tu2",
			tool_input: {},
		});
		expect(emit.mock.calls[1][0].turnId).toBe("t2");
	});

	it("timestamp is populated on emitted events", () => {
		const emit = vi.fn();
		const hooks = buildHooks(emit, CTX, () => "t1");
		hooks.PreToolUse[0].callback({
			tool_name: "bash",
			tool_use_id: "tu1",
			tool_input: {},
		});
		const event: NormalizedEvent = emit.mock.calls[0][0];
		expect(event.timestamp).toBeGreaterThan(0);
	});
});
