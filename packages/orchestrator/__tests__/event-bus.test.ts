import type { NormalizedEvent } from "@crossfire/adapter-core";
import type { OrchestratorEvent } from "@crossfire/orchestrator-core";
import { describe, expect, it, vi } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";

const config = {
	topic: "Test",
	maxRounds: 10,
	judgeEveryNRounds: 3,
	convergenceThreshold: 0.3,
};

describe("DebateEventBus", () => {
	it("starts with empty events", () => {
		const bus = new DebateEventBus();
		expect(bus.getEvents()).toHaveLength(0);
	});

	it("push appends event and notifies subscribers", () => {
		const bus = new DebateEventBus();
		const cb = vi.fn();
		bus.subscribe(cb);

		const event: OrchestratorEvent = {
			kind: "debate.started",
			config,
			timestamp: 1000,
		};
		bus.push(event);

		expect(bus.getEvents()).toHaveLength(1);
		expect(cb).toHaveBeenCalledWith(event);
	});

	it("unsubscribe stops delivery", () => {
		const bus = new DebateEventBus();
		const cb = vi.fn();
		const unsub = bus.subscribe(cb);

		bus.push({
			kind: "debate.started",
			config,
			timestamp: 1000,
		});
		expect(cb).toHaveBeenCalledTimes(1);

		unsub();

		bus.push({
			kind: "debate.completed",
			reason: "max-rounds",
			timestamp: 2000,
		});
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("snapshot returns projected state", () => {
		const bus = new DebateEventBus();
		bus.push({ kind: "debate.started", config, timestamp: 1000 });
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: 1001,
		});

		const state = bus.snapshot();
		expect(state.config.topic).toBe("Test");
		expect(state.phase).toBe("proposer-turn");
		expect(state.currentRound).toBe(1);
	});

	it("handles mixed NormalizedEvent and OrchestratorEvent", () => {
		const bus = new DebateEventBus();
		bus.push({ kind: "debate.started", config, timestamp: 1000 });
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: 1001,
		});

		const normalizedEvent: NormalizedEvent = {
			kind: "message.final",
			text: "Test argument",
			role: "assistant",
			timestamp: 1002,
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "p-1",
		};
		bus.push(normalizedEvent);

		const state = bus.snapshot();
		expect(state.turns).toHaveLength(1);
		expect(state.turns[0].content).toBe("Test argument");
	});

	it("multiple subscribers receive same events", () => {
		const bus = new DebateEventBus();
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		bus.subscribe(cb1);
		bus.subscribe(cb2);

		bus.push({ kind: "debate.started", config, timestamp: 1000 });
		expect(cb1).toHaveBeenCalledTimes(1);
		expect(cb2).toHaveBeenCalledTimes(1);
	});

	it("getEvents returns readonly copy", () => {
		const bus = new DebateEventBus();
		bus.push({ kind: "debate.started", config, timestamp: 1000 });

		const events = bus.getEvents();
		expect(events).toHaveLength(1);
	});
});
