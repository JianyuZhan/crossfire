import { describe, expect, it } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";
import { PlanAccumulator } from "../src/plan-accumulator.js";

/** Wait for queued microtasks (processRound is deferred via queueMicrotask) */
const tick = () => new Promise<void>((r) => queueMicrotask(r));

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
	it("builds EvolvingPlan from debate_meta on round.completed", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		await tick();

		const plan = acc.snapshot();
		expect(Object.keys(plan.arguments).length).toBeGreaterThan(0);
		expect(plan.roundSummaries).toHaveLength(1);
		unsub();
	});

	it("incorporates judge verdicts", () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		const acc = new PlanAccumulator();
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
		const acc = new PlanAccumulator();
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

	it("marks rounds without meta as degraded", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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

		// Push a round WITHOUT debate_meta tool calls
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "message.final",
			turnId: "p-1",
			text: "Proposer argument no meta",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		});
		bus.push({
			kind: "turn.completed",
			turnId: "p-1",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		});
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "message.final",
			turnId: "c-1",
			text: "Challenger argument no meta",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s2",
		});
		bus.push({
			kind: "turn.completed",
			turnId: "c-1",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s2",
		});
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		const plan = acc.snapshot();
		expect(plan.degradedRounds).toContain(1);
		unsub();
	});

	it("does not mark rounds with meta as degraded", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		await tick();

		const plan = acc.snapshot();
		expect(plan.degradedRounds).not.toContain(1);
		unsub();
	});

	it("persists roundAnalyses after processing", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		await tick();

		const plan = acc.snapshot();
		expect(plan.roundAnalyses ?? []).toHaveLength(1);
		expect((plan.roundAnalyses ?? [])[0].roundNumber).toBe(1);

		pushRound(bus, 2);
		await tick();

		const plan2 = acc.snapshot();
		expect(plan2.roundAnalyses ?? []).toHaveLength(2);
		expect((plan2.roundAnalyses ?? [])[0].roundNumber).toBe(1);
		expect((plan2.roundAnalyses ?? [])[1].roundNumber).toBe(2);
		unsub();
	});

	it("idempotent upsert on reprocess — no duplicate roundAnalyses", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		await tick();

		// Push another challenger round.completed for round 1 to trigger reprocess
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		const plan = acc.snapshot();
		const round1Analyses = (plan.roundAnalyses ?? []).filter(
			(a) => a.roundNumber === 1,
		);
		expect(round1Analyses).toHaveLength(1);
		unsub();
	});

	it("degraded round recovery removes round from degradedRounds", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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

		// Round 1 with no meta — will be degraded
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "message.final",
			turnId: "p-1",
			text: "Proposer R1 argument",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		});
		bus.push({
			kind: "turn.completed",
			turnId: "p-1",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		});
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "round.started",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		bus.push({
			kind: "message.final",
			turnId: "c-1",
			text: "Challenger R1 argument",
			role: "assistant",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s2",
		});
		bus.push({
			kind: "turn.completed",
			turnId: "c-1",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s2",
		});
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		// Round 1 should be degraded (no debate_meta tool calls)
		expect(acc.snapshot().degradedRounds).toContain(1);

		// Now reprocess round 1 with meta available (simulate late meta arrival)
		pushRound(bus, 1);
		await tick();

		// After reprocess with meta, round 1 should no longer be degraded
		const plan = acc.snapshot();
		expect(plan.degradedRounds).not.toContain(1);
		unsub();
	});

	it("persists judge score in judgeNotes when verdict has score", () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
				leading: "proposer",
				score: { proposer: 8, challenger: 6 },
				reasoning: "Strong opening",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.judgeNotes).toHaveLength(1);
		expect(plan.judgeNotes[0].score).toEqual({
			proposer: 8,
			challenger: 6,
		});
		unsub();
	});

	it("updatePlan preserves round-derived fields via spread", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
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
		await tick();

		const planAfterR1 = acc.snapshot();
		expect((planAfterR1.roundAnalyses ?? []).length).toBe(1);

		pushRound(bus, 2);
		await tick();

		// After round 2, updatePlan should preserve roundAnalyses from round 1
		const planAfterR2 = acc.snapshot();
		expect((planAfterR2.roundAnalyses ?? []).length).toBe(2);
		unsub();
	});
});
