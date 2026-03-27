import { describe, expect, it } from "vitest";
import type {
	SynthesisCompletedEvent,
	SynthesisErrorEvent,
} from "../src/orchestrator-events.js";

describe("synthesis audit event types", () => {
	it("SynthesisCompletedEvent carries optional debug metadata", () => {
		const event: SynthesisCompletedEvent = {
			kind: "synthesis.completed",
			quality: "llm-full",
			timestamp: Date.now(),
			debug: {
				budgetTier: "short",
				totalEstimatedTokens: 5000,
				budgetTokens: 64000,
				promptCharLength: 10000,
				fullTextRounds: [3, 4],
				compressedRounds: [1, 2],
				shrinkTrace: [],
				fitAchieved: true,
				durationMs: 1234,
			},
		};
		expect(event.debug?.budgetTier).toBe("short");
	});

	it("SynthesisCompletedEvent works without debug (backward compat)", () => {
		const event: SynthesisCompletedEvent = {
			kind: "synthesis.completed",
			quality: "local-degraded",
			timestamp: Date.now(),
		};
		expect(event.debug).toBeUndefined();
	});

	it("SynthesisErrorEvent captures phase and error message", () => {
		const event: SynthesisErrorEvent = {
			kind: "synthesis.error",
			phase: "llm-synthesis",
			message: "synthesis timeout",
			timestamp: Date.now(),
		};
		expect(event.phase).toBe("llm-synthesis");
		expect(event.message).toBe("synthesis timeout");
	});
});
