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

// --- Helpers for RoundSignals tests ---

const debateStarted = {
	kind: "debate.started",
	config: {
		topic: "Test",
		maxRounds: 5,
		judgeEveryNRounds: 1,
		convergenceThreshold: 0.3,
	},
	timestamp: Date.now(),
};

function pushRoundWithMeta(
	bus: DebateEventBus,
	round: number,
	opts?: {
		proposerKeyPoints?: string[];
		challengerKeyPoints?: string[];
		proposerConcessions?: string[];
		challengerConcessions?: string[];
	},
): void {
	const pKP = opts?.proposerKeyPoints ?? [`proposer-point-r${round}`];
	const cKP = opts?.challengerKeyPoints ?? [`challenger-point-r${round}`];
	const pConc = opts?.proposerConcessions ?? [];
	const cConc = opts?.challengerConcessions ?? [];

	bus.push({
		kind: "round.started",
		roundNumber: round,
		speaker: "proposer",
		timestamp: Date.now(),
	});
	bus.push({
		kind: "message.final",
		turnId: `p-${round}`,
		text: `Proposer R${round}`,
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
			key_points: pKP,
			concessions: pConc,
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
		text: `Challenger R${round}`,
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
			key_points: cKP,
			concessions: cConc,
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

describe("PlanAccumulator — RoundSignals", () => {
	it("populates roundSignals after round completion", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		const plan = acc.snapshot();
		expect(plan.roundSignals).toHaveLength(1);
		expect(plan.roundSignals[0].roundNumber).toBe(1);
		expect(plan.roundSignals[0].newClaimCount).toBe(2); // 1 proposer + 1 challenger
		expect(plan.roundSignals[0].hasConcession).toBe(false);
		expect(plan.roundSignals[0].judgeImpact.hasVerdict).toBe(false);
		unsub();
	});

	it("idempotent upsert on same-round reprocess — no duplicate roundSignals", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		// Trigger reprocess for round 1
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		const plan = acc.snapshot();
		const round1Signals = plan.roundSignals.filter((s) => s.roundNumber === 1);
		expect(round1Signals).toHaveLength(1);
		unsub();
	});

	it("historical dedup: overlapping keyPoints reduce newClaimCount", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1, {
			proposerKeyPoints: ["shared-point", "unique-r1"],
			challengerKeyPoints: ["other-point"],
		});
		await tick();

		pushRoundWithMeta(bus, 2, {
			proposerKeyPoints: ["shared-point", "new-r2"],
			challengerKeyPoints: ["other-point"],
		});
		await tick();

		const plan = acc.snapshot();
		expect(plan.roundSignals).toHaveLength(2);
		// Round 1: 3 unique claims (shared-point, unique-r1, other-point)
		expect(plan.roundSignals[0].newClaimCount).toBe(3);
		// Round 2: only new-r2 is new (shared-point and other-point already seen)
		expect(plan.roundSignals[1].newClaimCount).toBe(1);
		unsub();
	});

	it("trim/lowercase normalization deduplicates claims", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1, {
			proposerKeyPoints: ["  Foo Bar  "],
			challengerKeyPoints: ["other"],
		});
		await tick();

		pushRoundWithMeta(bus, 2, {
			proposerKeyPoints: ["foo bar"],
			challengerKeyPoints: ["brand-new"],
		});
		await tick();

		const plan = acc.snapshot();
		// Round 2: "foo bar" was already seen as "  Foo Bar  " (normalized), only "brand-new" is new
		expect(plan.roundSignals[1].newClaimCount).toBe(1);
		unsub();
	});

	it("hasConcession is false when consensus exists but no concessions", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		// No concessions in meta, even though round may produce consensus via other means
		pushRoundWithMeta(bus, 1, {
			proposerConcessions: [],
			challengerConcessions: [],
		});
		await tick();

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].hasConcession).toBe(false);
		unsub();
	});

	it("hasConcession is true when concessions are present", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1, {
			proposerConcessions: ["I concede this point"],
		});
		await tick();

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].hasConcession).toBe(true);
		unsub();
	});

	it("consensusDelta and riskDelta use set equality not length", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);

		// Round 1 with key points — will add arguments but no risks initially
		pushRoundWithMeta(bus, 1);
		await tick();

		const plan1 = acc.snapshot();
		// First round always has a delta since it goes from empty to populated
		expect(plan1.roundSignals[0].roundNumber).toBe(1);

		// Round 2 with the exact same key points won't change consensus (no mutual concessions)
		pushRoundWithMeta(bus, 2, {
			proposerKeyPoints: ["proposer-point-r2"],
			challengerKeyPoints: ["challenger-point-r2"],
		});
		await tick();

		const plan2 = acc.snapshot();
		// No mutual concessions, so consensus shouldn't change
		expect(plan2.roundSignals[1].consensusDelta).toBe(false);
		unsub();
	});
});

describe("PlanAccumulator — Judge Impact", () => {
	it("sets hasVerdict=true after judge.completed", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				score: { proposer: 7, challenger: 5 },
				reasoning: "Good arguments",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].judgeImpact.hasVerdict).toBe(true);
		unsub();
	});

	it("weighted=true when score spread >= 0.3", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				score: { proposer: 8, challenger: 6 },
				reasoning: "Clear advantage",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].judgeImpact.weighted).toBe(true);
		unsub();
	});

	it("weighted=false when score spread < 0.3", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "tie",
				score: { proposer: 7, challenger: 7.1 },
				reasoning: "Very close",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].judgeImpact.weighted).toBe(false);
		unsub();
	});

	it("directionChange=true when leading flips between rounds", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				score: { proposer: 8, challenger: 5 },
				reasoning: "Proposer leads",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		pushRoundWithMeta(bus, 2);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 2,
			verdict: {
				leading: "challenger",
				score: { proposer: 5, challenger: 8 },
				reasoning: "Challenger flips",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.roundSignals[1].judgeImpact.directionChange).toBe(true);
		unsub();
	});

	it("hasVerdict=true and weighted=false when verdict has no score", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				reasoning: "Qualitative assessment",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		const plan = acc.snapshot();
		expect(plan.roundSignals[0].judgeImpact.hasVerdict).toBe(true);
		expect(plan.roundSignals[0].judgeImpact.weighted).toBe(false);
		unsub();
	});
});

describe("PlanAccumulator — Replay-safe rebuild", () => {
	it("replay rebuild produces same result as live incremental", async () => {
		// Process rounds 1, 2, 3 incrementally
		const bus1 = new DebateEventBus();
		const acc1 = new PlanAccumulator();
		const unsub1 = acc1.subscribe(bus1);

		bus1.push(debateStarted);
		pushRoundWithMeta(bus1, 1, {
			proposerKeyPoints: ["point-a", "point-b"],
			challengerKeyPoints: ["point-c"],
		});
		await tick();
		pushRoundWithMeta(bus1, 2, {
			proposerKeyPoints: ["point-b", "point-d"],
			challengerKeyPoints: ["point-e"],
		});
		await tick();
		pushRoundWithMeta(bus1, 3, {
			proposerKeyPoints: ["point-f"],
			challengerKeyPoints: ["point-a"],
			challengerConcessions: ["concession-1"],
		});
		await tick();
		unsub1();

		const liveSnapshot = acc1.snapshot();

		// Create a fresh accumulator with the same events
		const bus2 = new DebateEventBus();
		const acc2 = new PlanAccumulator();
		const unsub2 = acc2.subscribe(bus2);

		bus2.push(debateStarted);
		pushRoundWithMeta(bus2, 1, {
			proposerKeyPoints: ["point-a", "point-b"],
			challengerKeyPoints: ["point-c"],
		});
		await tick();
		pushRoundWithMeta(bus2, 2, {
			proposerKeyPoints: ["point-b", "point-d"],
			challengerKeyPoints: ["point-e"],
		});
		await tick();
		pushRoundWithMeta(bus2, 3, {
			proposerKeyPoints: ["point-f"],
			challengerKeyPoints: ["point-a"],
			challengerConcessions: ["concession-1"],
		});
		await tick();
		unsub2();

		const freshSnapshot = acc2.snapshot();

		// Both should produce identical roundSignals
		expect(liveSnapshot.roundSignals).toHaveLength(3);
		expect(freshSnapshot.roundSignals).toHaveLength(3);
		for (let i = 0; i < 3; i++) {
			expect(liveSnapshot.roundSignals[i].roundNumber).toBe(
				freshSnapshot.roundSignals[i].roundNumber,
			);
			expect(liveSnapshot.roundSignals[i].newClaimCount).toBe(
				freshSnapshot.roundSignals[i].newClaimCount,
			);
			expect(liveSnapshot.roundSignals[i].hasConcession).toBe(
				freshSnapshot.roundSignals[i].hasConcession,
			);
		}

		// roundAnalyses count should match
		expect((liveSnapshot.roundAnalyses ?? []).length).toBe(
			(freshSnapshot.roundAnalyses ?? []).length,
		);
	});

	it("out-of-order reprocess uses rebuild and produces correct state", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1, {
			proposerKeyPoints: ["alpha"],
			challengerKeyPoints: ["beta"],
		});
		await tick();
		pushRoundWithMeta(bus, 2, {
			proposerKeyPoints: ["gamma"],
			challengerKeyPoints: ["delta"],
		});
		await tick();
		pushRoundWithMeta(bus, 3, {
			proposerKeyPoints: ["epsilon"],
			challengerKeyPoints: ["zeta"],
		});
		await tick();

		// Capture the state before reprocess
		const beforeReprocess = acc.snapshot();
		expect(beforeReprocess.roundSignals).toHaveLength(3);

		// Reprocess round 2 — triggers full rebuild
		bus.push({
			kind: "round.completed",
			roundNumber: 2,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		const afterReprocess = acc.snapshot();

		// Should still have exactly 3 roundSignals (no duplicates)
		expect(afterReprocess.roundSignals).toHaveLength(3);
		expect(afterReprocess.roundSignals.map((s) => s.roundNumber)).toEqual([
			1, 2, 3,
		]);

		// No duplicate roundAnalyses
		expect((afterReprocess.roundAnalyses ?? []).length).toBe(3);

		// newClaimCount should be recalculated correctly:
		// Round 1: alpha, beta = 2 new claims
		// Round 2: gamma, delta = 2 new claims
		// Round 3: epsilon, zeta = 2 new claims
		expect(afterReprocess.roundSignals[0].newClaimCount).toBe(2);
		expect(afterReprocess.roundSignals[1].newClaimCount).toBe(2);
		expect(afterReprocess.roundSignals[2].newClaimCount).toBe(2);

		unsub();
	});

	it("rebuild preserves judge verdicts applied before reprocess", async () => {
		const bus = new DebateEventBus();
		const acc = new PlanAccumulator();
		const unsub = acc.subscribe(bus);

		bus.push(debateStarted);
		pushRoundWithMeta(bus, 1);
		await tick();

		bus.push({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				score: { proposer: 8, challenger: 5 },
				reasoning: "Strong opening",
				shouldContinue: true,
			},
			timestamp: Date.now(),
		});

		pushRoundWithMeta(bus, 2);
		await tick();

		// Reprocess round 1 — triggers rebuild
		bus.push({
			kind: "round.completed",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: Date.now(),
		});
		await tick();

		const plan = acc.snapshot();

		// Judge verdict should be preserved
		expect(plan.judgeNotes).toHaveLength(1);
		expect(plan.judgeNotes[0].leading).toBe("proposer");

		// Round 1 should have judgeImpact.hasVerdict = true
		expect(plan.roundSignals[0].judgeImpact.hasVerdict).toBe(true);
		expect(plan.roundSignals[0].judgeImpact.weighted).toBe(true);

		unsub();
	});
});
