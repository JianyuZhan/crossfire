import { describe, expect, it, vi } from "vitest";

describe("runFinalSynthesis", () => {
	const adapterSessionId = "synth-session-1";

	/** Create a mock adapter that emits canned events via onEvent callback */
	function createMockAdapter(eventsToEmit?: Array<Record<string, unknown>>) {
		let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
		return {
			id: "mock",
			startSession: vi.fn().mockResolvedValue({
				adapterSessionId,
				providerSessionId: undefined,
				adapterId: "mock",
			}),
			sendTurn: vi.fn().mockImplementation(async () => {
				if (eventsToEmit && onEventCb) {
					const cb = onEventCb;
					queueMicrotask(() => {
						for (const e of eventsToEmit) cb(e);
					});
				}
			}),
			close: vi.fn().mockResolvedValue(undefined),
			onEvent: vi
				.fn()
				.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
					onEventCb = cb;
					return () => {
						onEventCb = undefined;
					};
				}),
		};
	}

	it("returns markdown from message.final when synthesis succeeds", async () => {
		const mockAdapter = createMockAdapter([
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: "## Executive Summary\n\nFull report.",
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 500,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result).toContain("Executive Summary");
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("returns undefined on timeout and still closes session", async () => {
		const mockAdapter = createMockAdapter(); // no events → timeout

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			100,
		);
		expect(result).toBeUndefined();
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("falls back to delta buffer when message.final is missing", async () => {
		const mockAdapter = createMockAdapter([
			{
				kind: "message.delta",
				turnId: "synthesis-final",
				text: "## Report from deltas",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 300,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result).toContain("Report from deltas");
	});

	it("keeps the longest message.final when multiple are emitted", async () => {
		const shortText = "Short summary of the report.";
		const longText =
			"## Executive Summary\n\nThis is a comprehensive, detailed report that covers all sections including consensus items, unresolved disagreements, risk matrix, and evidence registry. It represents the full synthesis output.";
		const mockAdapter = createMockAdapter([
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: shortText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: longText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: shortText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 1000,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result).toBe(longText);
	});
});
