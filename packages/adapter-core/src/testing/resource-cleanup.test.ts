import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../types.js";
import { collectEvents } from "./helpers.js";

/**
 * Resource cleanup pattern tests
 *
 * These tests verify that the testing helpers (collectEvents, unsubscribe)
 * work correctly for cleanup verification scenarios. The actual adapter-specific
 * cleanup tests (e.g., close() behavior, pending approval cleanup) are in each
 * adapter's test file.
 */
describe("resource cleanup (infrastructure test)", () => {
	it("collectEvents provides unsubscribe that stops delivery", () => {
		const listeners: Array<(e: NormalizedEvent) => void> = [];

		// Mock adapter with onEvent method
		const mockAdapter = {
			onEvent: (cb: (e: NormalizedEvent) => void) => {
				listeners.push(cb);
				return () => {
					const idx = listeners.indexOf(cb);
					if (idx !== -1) listeners.splice(idx, 1);
				};
			},
		};

		const { events: collectedEvents, unsubscribe } = collectEvents(mockAdapter);

		// Emit event before unsubscribe
		const testEvent: NormalizedEvent = {
			kind: "message.delta",
			text: "test",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
		};
		for (const listener of listeners) {
			listener(testEvent);
		}
		expect(collectedEvents).toHaveLength(1);

		// Unsubscribe
		unsubscribe();

		// Emit event after unsubscribe
		const testEvent2: NormalizedEvent = {
			kind: "message.delta",
			text: "test2",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
		};
		for (const listener of listeners) {
			listener(testEvent2);
		}

		// Should still have only 1 event
		expect(collectedEvents).toHaveLength(1);
	});

	it("multiple collectEvents instances can unsubscribe independently", () => {
		const listeners: Array<(e: NormalizedEvent) => void> = [];

		const mockAdapter = {
			onEvent: (cb: (e: NormalizedEvent) => void) => {
				listeners.push(cb);
				return () => {
					const idx = listeners.indexOf(cb);
					if (idx !== -1) listeners.splice(idx, 1);
				};
			},
		};

		const collector1 = collectEvents(mockAdapter);
		const collector2 = collectEvents(mockAdapter);

		const testEvent: NormalizedEvent = {
			kind: "message.delta",
			text: "test",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
		};

		// Both should receive events
		for (const listener of listeners) {
			listener(testEvent);
		}
		expect(collector1.events).toHaveLength(1);
		expect(collector2.events).toHaveLength(1);

		// Unsubscribe collector1
		collector1.unsubscribe();

		// Emit another event
		const testEvent2: NormalizedEvent = {
			kind: "message.delta",
			text: "test2",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
		};
		for (const listener of listeners) {
			listener(testEvent2);
		}

		// Collector1 should still have 1 event, collector2 should have 2
		expect(collector1.events).toHaveLength(1);
		expect(collector2.events).toHaveLength(2);
	});
});
