import { describe, expect, it } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";
import { PlanAccumulator } from "../src/plan-accumulator.js";
import type { SynthesizerConfig } from "../src/round-synthesizer.js";

const disabledConfig: SynthesizerConfig = {
	enabled: false,
	timeoutMs: 5000,
	flushTimeoutMs: 5000,
};

function pushRound(bus: DebateEventBus, round: number): void {
	bus.push({
		kind: "round.started",
		roundNumber: round,
		speaker: "proposer",
		timestamp: Date.now(),
	});
	bus.push({
		kind: "message.final",
		turnId: `p-${round}`,
		text: `Proposer R${round} argument`,
		role: "assistant",
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s1",
	});
	bus.push({
		kind: "tool.call",
		turnId: `p-${round}`,
		toolName: "debate_meta",
		toolUseId: `tu-p-${round}`,
		input: {
			stance: "agree",
			confidence: 0.8,
			key_points: [`proposer-point-r${round}`],
			concessions: [],
		},
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s1",
	});
	bus.push({
		kind: "turn.completed",
		turnId: `p-${round}`,
		status: "completed",
		durationMs: 100,
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s1",
	});
	bus.push({
		kind: "round.completed",
		roundNumber: round,
		speaker: "proposer",
		timestamp: Date.now(),
	});

	bus.push({
		kind: "round.started",
		roundNumber: round,
		speaker: "challenger",
		timestamp: Date.now(),
	});
	bus.push({
		kind: "message.final",
		turnId: `c-${round}`,
		text: `Challenger R${round} argument`,
		role: "assistant",
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s2",
	});
	bus.push({
		kind: "tool.call",
		turnId: `c-${round}`,
		toolName: "debate_meta",
		toolUseId: `tu-c-${round}`,
		input: {
			stance: "disagree",
			confidence: 0.7,
			key_points: [`challenger-point-r${round}`],
		},
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s2",
	});
	bus.push({
		kind: "turn.completed",
		turnId: `c-${round}`,
		status: "completed",
		durationMs: 100,
		timestamp: Date.now(),
		adapterId: "claude",
		adapterSessionId: "s2",
	});
	bus.push({
		kind: "round.completed",
		roundNumber: round,
		speaker: "challenger",
		timestamp: Date.now(),
	});
}

describe("PlanAccumulator", () => {
	it("builds EvolvingPlan from debate_meta on round.completed", () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator(disabledConfig);
		const unsub = acc.subscribe(bus);

		bus.push({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 3,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			timestamp: Date.now(),
		});
		pushRound(bus, 1);

		const plan = acc.snapshot();
		expect(Object.keys(plan.arguments).length).toBeGreaterThan(0);
		expect(plan.roundSummaries).toHaveLength(1);
		unsub();
	});

	it("incorporates judge verdicts", () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator(disabledConfig);
		const unsub = acc.subscribe(bus);

		bus.push({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 3,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			timestamp: Date.now(),
		});
		pushRound(bus, 1);
		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "challenger",
				score: { proposer: 6, challenger: 7 },
				reasoning: "Good critique",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.judgeNotes).toHaveLength(1);
		expect(plan.judgeNotes[0].leading).toBe("challenger");
		unsub();
	});

	it("flush resolves immediately when no async tasks", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator(disabledConfig);
		const unsub = acc.subscribe(bus);

		bus.push({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 3,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			timestamp: Date.now(),
		});
		pushRound(bus, 1);

		await acc.flush();
		unsub();
	});

	it("freezes plan after flush — subsequent updates ignored", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator(disabledConfig);
		const unsub = acc.subscribe(bus);

		bus.push({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 3,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			timestamp: Date.now(),
		});
		pushRound(bus, 1);
		await acc.flush();

		const planBefore = acc.snapshot();
		pushRound(bus, 2);
		const planAfter = acc.snapshot();

		expect(Object.keys(planAfter.arguments).length).toBe(
			Object.keys(planBefore.arguments).length,
		);
		unsub();
	});

	it("tracks degraded rounds when synthesizer is disabled", () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator(disabledConfig);
		const unsub = acc.subscribe(bus);

		bus.push({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 3,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			timestamp: Date.now(),
		});
		pushRound(bus, 1);

		const plan = acc.snapshot();
		expect(plan.degradedRounds).toContain(1);
		unsub();
	});
});
