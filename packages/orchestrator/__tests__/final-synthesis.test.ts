import { describe, expect, it, vi } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";

describe("runFinalSynthesis", () => {
	const adapterSessionId = "synth-session-1";

	/** Create a mock adapter that emits canned events via onEvent callback */
	function createMockAdapter(
		bus: DebateEventBus,
		eventsToEmit?: Array<Record<string, unknown>>,
	) {
		return {
			id: "mock",
			startSession: vi.fn().mockResolvedValue({
				adapterSessionId,
				providerSessionId: undefined,
				adapterId: "mock",
			}),
			sendTurn: vi.fn().mockImplementation(async () => {
				if (eventsToEmit) {
					queueMicrotask(() => {
						for (const e of eventsToEmit) bus.push(e as any);
					});
				}
			}),
			close: vi.fn().mockResolvedValue(undefined),
			onEvent: vi.fn().mockReturnValue(() => {}),
		};
	}

	it("returns markdown from message.final when synthesis succeeds", async () => {
		const bus = new DebateEventBus();
		const mockAdapter = createMockAdapter(bus, [
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
			bus,
			"test prompt",
			10_000,
		);
		expect(result).toContain("Executive Summary");
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("returns undefined on timeout and still closes session", async () => {
		const bus = new DebateEventBus();
		const mockAdapter = createMockAdapter(bus); // no events → timeout

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			bus,
			"test prompt",
			100,
		);
		expect(result).toBeUndefined();
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("falls back to delta buffer when message.final is missing", async () => {
		const bus = new DebateEventBus();
		const mockAdapter = createMockAdapter(bus, [
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
			bus,
			"test prompt",
			10_000,
		);
		expect(result).toContain("Report from deltas");
	});
});
