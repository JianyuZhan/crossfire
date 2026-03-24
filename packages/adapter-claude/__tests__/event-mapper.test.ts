import { describe, expect, it } from "vitest";
import { mapSdkMessage } from "../src/event-mapper.js";

const CTX = {
	adapterId: "claude" as const,
	adapterSessionId: "s1",
	turnId: "t1",
};

describe("mapSdkMessage", () => {
	it("maps system/init to session.started", () => {
		const msg = {
			type: "system/init",
			sessionId: "ps1",
			model: "haiku",
			tools: ["bash"],
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("session.started");
		if (events[0].kind === "session.started") {
			expect(events[0].providerSessionId).toBe("ps1");
			expect(events[0].model).toBe("haiku");
		}
	});

	it("maps stream_event text to message.delta", () => {
		const msg = {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "Hello" },
			},
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("message.delta");
	});

	it("maps stream_event thinking to thinking.delta", () => {
		const msg = {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "I think..." },
			},
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("thinking.delta");
		if (events[0].kind === "thinking.delta") {
			expect(events[0].thinkingType).toBe("raw-thinking");
		}
	});

	it("maps assistant to message.final", () => {
		const msg = {
			type: "assistant",
			content: "Full response text",
			stopReason: "end_turn",
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("message.final");
	});

	it("maps result success to usage.updated + turn.completed", () => {
		const msg = {
			type: "result",
			subtype: "success",
			usage: { input_tokens: 100, output_tokens: 50 },
			cost_usd: 0.01,
			duration_ms: 1500,
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(2);
		expect(events[0].kind).toBe("usage.updated");
		expect(events[1].kind).toBe("turn.completed");
		if (events[1].kind === "turn.completed") {
			expect(events[1].status).toBe("completed");
		}
	});

	it("maps result error_max_turns to turn.completed failed", () => {
		const msg = {
			type: "result",
			subtype: "error_max_turns",
			usage: { input_tokens: 100, output_tokens: 50 },
			duration_ms: 2000,
		};
		const events = mapSdkMessage(msg, CTX);
		const tc = events.find((e) => e.kind === "turn.completed");
		expect(tc).toBeDefined();
		if (tc?.kind === "turn.completed") {
			expect(tc.status).toBe("failed");
		}
	});

	it("maps tool_progress to tool.progress", () => {
		const msg = {
			type: "tool_progress",
			toolUseId: "tu1",
			toolName: "bash",
			elapsedSeconds: 5,
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.progress");
	});

	it("returns empty array for unknown message types", () => {
		const msg = { type: "unknown_type" };
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(0);
	});

	it("returns empty array for stream_event with non-delta event type", () => {
		const msg = {
			type: "stream_event",
			event: { type: "content_block_start" },
		};
		const events = mapSdkMessage(msg, CTX);
		expect(events).toHaveLength(0);
	});

	it("maps result with usage to usage.updated with correct token counts", () => {
		const msg = {
			type: "result",
			subtype: "success",
			usage: { input_tokens: 200, output_tokens: 80 },
			cost_usd: 0.05,
			duration_ms: 3000,
		};
		const events = mapSdkMessage(msg, CTX);
		const usage = events.find((e) => e.kind === "usage.updated");
		expect(usage).toBeDefined();
		if (usage?.kind === "usage.updated") {
			expect(usage.inputTokens).toBe(200);
			expect(usage.outputTokens).toBe(80);
			expect(usage.totalCostUsd).toBe(0.05);
		}
	});

	it("maps result error_during_execution to failed", () => {
		const msg = {
			type: "result",
			subtype: "error_during_execution",
			usage: { input_tokens: 50, output_tokens: 10 },
			duration_ms: 500,
		};
		const events = mapSdkMessage(msg, CTX);
		const tc = events.find((e) => e.kind === "turn.completed");
		expect(tc).toBeDefined();
		if (tc?.kind === "turn.completed") {
			expect(tc.status).toBe("failed");
		}
	});

	it("maps result error_max_budget_usd to failed", () => {
		const msg = {
			type: "result",
			subtype: "error_max_budget_usd",
			usage: { input_tokens: 50, output_tokens: 10 },
			duration_ms: 500,
		};
		const events = mapSdkMessage(msg, CTX);
		const tc = events.find((e) => e.kind === "turn.completed");
		if (tc?.kind === "turn.completed") {
			expect(tc.status).toBe("failed");
		}
	});

	it("maps result error_max_structured_output_retries to failed", () => {
		const msg = {
			type: "result",
			subtype: "error_max_structured_output_retries",
			usage: { input_tokens: 30, output_tokens: 15 },
			duration_ms: 700,
		};
		const events = mapSdkMessage(msg, CTX);
		const tc = events.find((e) => e.kind === "turn.completed");
		expect(tc).toBeDefined();
		if (tc?.kind === "turn.completed") {
			expect(tc.status).toBe("failed");
		}
	});

	it("includes durationMs in turn.completed from result", () => {
		const msg = {
			type: "result",
			subtype: "success",
			usage: { input_tokens: 10, output_tokens: 5 },
			duration_ms: 4200,
		};
		const events = mapSdkMessage(msg, CTX);
		const tc = events.find((e) => e.kind === "turn.completed");
		if (tc?.kind === "turn.completed") {
			expect(tc.durationMs).toBe(4200);
		}
	});

	it("maps message.final with stopReason", () => {
		const msg = {
			type: "assistant",
			content: "Done",
			stopReason: "end_turn",
		};
		const events = mapSdkMessage(msg, CTX);
		if (events[0].kind === "message.final") {
			expect(events[0].stopReason).toBe("end_turn");
			expect(events[0].text).toBe("Done");
			expect(events[0].role).toBe("assistant");
		}
	});

	it("maps message.delta with correct text and role", () => {
		const msg = {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "chunk" },
			},
		};
		const events = mapSdkMessage(msg, CTX);
		if (events[0].kind === "message.delta") {
			expect(events[0].text).toBe("chunk");
			expect(events[0].role).toBe("assistant");
		}
	});

	it("maps session.started with tools and capabilities", () => {
		const msg = {
			type: "system/init",
			sessionId: "ps1",
			model: "opus",
			tools: ["bash", "read", "write"],
		};
		const events = mapSdkMessage(msg, CTX);
		if (events[0].kind === "session.started") {
			expect(events[0].tools).toEqual(["bash", "read", "write"]);
			expect(events[0].capabilities).toBeDefined();
		}
	});
});
