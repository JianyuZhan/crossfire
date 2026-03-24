import { describe, expect, it } from "vitest";
import { type GeminiMapContext, mapGeminiEvent } from "../src/event-mapper.js";

function makeCtx(overrides: Partial<GeminiMapContext> = {}): GeminiMapContext {
	return {
		adapterId: "gemini",
		adapterSessionId: "s1",
		turnId: "t1",
		sessionStarted: false,
		messageBuffer: "",
		...overrides,
	};
}

describe("mapGeminiEvent", () => {
	it("maps init to session.started (first time)", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{ type: "init", session_id: "gs1", model: "gemini-pro" },
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("session.started");
		if (events[0].kind === "session.started") {
			expect(events[0].providerSessionId).toBe("gs1");
			expect(events[0].model).toBe("gemini-pro");
		}
		expect(ctx.sessionStarted).toBe(true);
	});

	it("init second time returns empty (no duplicate session.started)", () => {
		const ctx = makeCtx({ sessionStarted: true });
		const events = mapGeminiEvent(
			{ type: "init", session_id: "gs1", model: "gemini-pro" },
			ctx,
		);
		expect(events).toHaveLength(0);
	});

	it("maps message to message.delta", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent({ type: "message", text: "Hello" }, ctx);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("message.delta");
		if (events[0].kind === "message.delta") {
			expect(events[0].text).toBe("Hello");
			expect(events[0].role).toBe("assistant");
		}
	});

	it("message with role field uses provided role", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{ type: "message", text: "Hi", role: "assistant" },
			ctx,
		);
		expect(events).toHaveLength(1);
		if (events[0].kind === "message.delta") {
			expect(events[0].role).toBe("assistant");
		}
	});

	it("message with empty text returns empty", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent({ type: "message", text: "" }, ctx);
		expect(events).toHaveLength(0);
	});

	it("message accumulates in messageBuffer", () => {
		const ctx = makeCtx();
		mapGeminiEvent({ type: "message", text: "Hello " }, ctx);
		mapGeminiEvent({ type: "message", text: "world!" }, ctx);
		expect(ctx.messageBuffer).toBe("Hello world!");
	});

	it("maps thought to thinking.delta (raw-thinking)", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{ type: "thought", text: "I should think about this..." },
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("thinking.delta");
		if (events[0].kind === "thinking.delta") {
			expect(events[0].text).toBe("I should think about this...");
			expect(events[0].thinkingType).toBe("raw-thinking");
		}
	});

	it("maps tool_use to tool.call", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{
				type: "tool_use",
				tool_use_id: "tu1",
				name: "read_file",
				input: { path: "/a.ts" },
			},
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.call");
		if (events[0].kind === "tool.call") {
			expect(events[0].toolUseId).toBe("tu1");
			expect(events[0].toolName).toBe("read_file");
			expect(events[0].input).toEqual({ path: "/a.ts" });
		}
	});

	it("maps tool_result to tool.result", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{
				type: "tool_result",
				tool_use_id: "tu1",
				name: "read_file",
				success: true,
				output: "content",
			},
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("tool.result");
		if (events[0].kind === "tool.result") {
			expect(events[0].toolUseId).toBe("tu1");
			expect(events[0].success).toBe(true);
		}
	});

	it("maps error (non-fatal) to run.warning", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{ type: "error", message: "Rate limited", fatal: false },
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("run.warning");
	});

	it("maps error (fatal) to run.error", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent(
			{ type: "error", message: "Auth failed", fatal: true },
			ctx,
		);
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("run.error");
		if (events[0].kind === "run.error") {
			expect(events[0].message).toBe("Auth failed");
			expect(events[0].recoverable).toBe(false);
		}
	});

	it("maps result: flushes buffer + usage + turn.completed", () => {
		const ctx = makeCtx({ messageBuffer: "Full response text" });
		const events = mapGeminiEvent(
			{
				type: "result",
				usage: { input_tokens: 100, output_tokens: 50 },
				duration_ms: 2000,
			},
			ctx,
		);
		expect(events).toHaveLength(3);
		// message.final from buffer flush
		expect(events[0].kind).toBe("message.final");
		if (events[0].kind === "message.final") {
			expect(events[0].text).toBe("Full response text");
		}
		// usage.updated
		expect(events[1].kind).toBe("usage.updated");
		// turn.completed
		expect(events[2].kind).toBe("turn.completed");
		if (events[2].kind === "turn.completed") {
			expect(events[2].status).toBe("completed");
			expect(events[2].durationMs).toBe(2000);
		}
		// Buffer should be cleared
		expect(ctx.messageBuffer).toBe("");
	});

	it("result with empty buffer: no message.final", () => {
		const ctx = makeCtx({ messageBuffer: "" });
		const events = mapGeminiEvent(
			{
				type: "result",
				usage: { input_tokens: 10, output_tokens: 5 },
				duration_ms: 500,
			},
			ctx,
		);
		// Should only have usage.updated + turn.completed (no message.final)
		expect(events.filter((e) => e.kind === "message.final")).toHaveLength(0);
		expect(events.filter((e) => e.kind === "usage.updated")).toHaveLength(1);
		expect(events.filter((e) => e.kind === "turn.completed")).toHaveLength(1);
	});

	it("returns empty for unknown event types", () => {
		const ctx = makeCtx();
		const events = mapGeminiEvent({ type: "unknown" }, ctx);
		expect(events).toHaveLength(0);
	});
});
