import { describe, expect, it } from "vitest";
import {
	type EvolvingPlan,
	type RoundAnalysis,
	buildFallbackRoundAnalysis,
	emptyPlan,
	replayPlan,
	updatePlan,
	updatePlanWithJudge,
} from "../src/evolving-plan.js";
import type { DebateMeta, JudgeVerdict } from "../src/types.js";

describe("emptyPlan", () => {
	it("returns a plan with empty collections", () => {
		const plan = emptyPlan();
		expect(Object.keys(plan.arguments)).toHaveLength(0);
		expect(plan.consensus).toHaveLength(0);
		expect(plan.unresolved).toHaveLength(0);
		expect(plan.risks).toHaveLength(0);
		expect(plan.evidence).toHaveLength(0);
		expect(plan.judgeNotes).toHaveLength(0);
		expect(plan.roundSummaries).toHaveLength(0);
		expect(plan.degradedRounds).toHaveLength(0);
	});
});

describe("updatePlan", () => {
	it("adds new arguments from RoundAnalysis", () => {
		const plan = emptyPlan();
		const analysis: RoundAnalysis = {
			roundNumber: 1,
			newArguments: [
				{ side: "proposer", argument: "We should do X", strength: "strong" },
				{ side: "challenger", argument: "X has risk Y", strength: "moderate" },
			],
			challengedArguments: [],
			risksIdentified: [],
			evidenceCited: [],
			newConsensus: [],
			newDivergence: [],
			roundSummary: "Round 1: Initial positions stated.",
		};

		const updated = updatePlan(plan, analysis);
		const argKeys = Object.keys(updated.arguments);
		expect(argKeys).toHaveLength(2);
		expect(updated.arguments["r1-proposer-0"].text).toBe("We should do X");
		expect(updated.arguments["r1-proposer-0"].status).toBe("active");
		expect(updated.arguments["r1-challenger-0"].text).toBe("X has risk Y");
		expect(updated.roundSummaries).toHaveLength(1);
	});

	it("updates argument status when challenged", () => {
		let plan = emptyPlan();
		const r1: RoundAnalysis = {
			roundNumber: 1,
			newArguments: [
				{ side: "proposer", argument: "Do X", strength: "strong" },
			],
			challengedArguments: [],
			risksIdentified: [],
			evidenceCited: [],
			newConsensus: [],
			newDivergence: [],
			roundSummary: "R1",
		};
		plan = updatePlan(plan, r1);

		const r2: RoundAnalysis = {
			roundNumber: 2,
			newArguments: [],
			challengedArguments: [
				{
					argument: "Do X",
					challengedBy: "X is too expensive",
					outcome: "weakened",
				},
			],
			risksIdentified: [],
			evidenceCited: [],
			newConsensus: [],
			newDivergence: [],
			roundSummary: "R2",
		};
		plan = updatePlan(plan, r2);
		expect(plan.arguments["r1-proposer-0"].status).toBe("weakened");
		expect(plan.arguments["r1-proposer-0"].challenges).toHaveLength(1);
	});

	it("accumulates risks and evidence", () => {
		const plan = emptyPlan();
		const analysis: RoundAnalysis = {
			roundNumber: 1,
			newArguments: [],
			challengedArguments: [],
			risksIdentified: [
				{ risk: "latency", severity: "high", raisedBy: "challenger" },
			],
			evidenceCited: [
				{ claim: "P99 < 100ms", source: "benchmark", side: "proposer" },
			],
			newConsensus: ["Both agree on API design"],
			newDivergence: ["Disagree on scaling"],
			roundSummary: "R1",
		};

		const updated = updatePlan(plan, analysis);
		expect(updated.risks).toHaveLength(1);
		expect(updated.evidence).toHaveLength(1);
		expect(updated.consensus).toContain("Both agree on API design");
		expect(updated.unresolved).toContain("Disagree on scaling");
	});
});

describe("updatePlanWithJudge", () => {
	it("adds judge verdict to judgeNotes", () => {
		const plan = emptyPlan();
		const verdict: JudgeVerdict = {
			leading: "challenger",
			score: { proposer: 6, challenger: 7 },
			reasoning: "Challenger raised valid cost concerns.",
			shouldContinue: true,
		};
		const updated = updatePlanWithJudge(plan, verdict, 2);
		expect(updated.judgeNotes).toHaveLength(1);
		expect(updated.judgeNotes[0].roundNumber).toBe(2);
		expect(updated.judgeNotes[0].leading).toBe("challenger");
	});
});

describe("buildFallbackRoundAnalysis", () => {
	it("builds degraded RoundAnalysis from DebateMeta pair", () => {
		const proposerMeta: DebateMeta = {
			stance: "agree",
			confidence: 0.8,
			keyPoints: ["point A", "point B"],
			concessions: ["concede C for clarity"],
			riskFlags: [{ risk: "cost risk", severity: "medium" }],
		};
		const challengerMeta: DebateMeta = {
			stance: "disagree",
			confidence: 0.7,
			keyPoints: ["counter X"],
			evidence: [{ claim: "data shows Y", source: "study" }],
			concessions: ["concede C for clarity as well"],
		};

		const analysis = buildFallbackRoundAnalysis(
			1,
			proposerMeta,
			challengerMeta,
		);
		expect(analysis.roundNumber).toBe(1);
		expect(analysis.newArguments).toHaveLength(3); // 2 proposer + 1 challenger
		expect(analysis.risksIdentified).toHaveLength(1);
		expect(analysis.evidenceCited).toHaveLength(1);
		expect(analysis.newConsensus.length).toBeGreaterThan(0);
	});

	it("handles missing optional fields gracefully", () => {
		const meta: DebateMeta = {
			stance: "neutral",
			confidence: 0.5,
			keyPoints: ["only point"],
		};
		const analysis = buildFallbackRoundAnalysis(1, meta, undefined);
		expect(analysis.newArguments).toHaveLength(1);
		expect(analysis.risksIdentified).toHaveLength(0);
		expect(analysis.roundSummary).toContain("Round 1");
	});
});

describe("replayPlan", () => {
	it("produces deterministic result regardless of insertion order", () => {
		const r1: RoundAnalysis = {
			roundNumber: 1,
			newArguments: [{ side: "proposer", argument: "A", strength: "strong" }],
			challengedArguments: [],
			risksIdentified: [],
			evidenceCited: [],
			newConsensus: [],
			newDivergence: [],
			roundSummary: "R1",
		};
		const r2: RoundAnalysis = {
			roundNumber: 2,
			newArguments: [
				{ side: "challenger", argument: "B", strength: "moderate" },
			],
			challengedArguments: [],
			risksIdentified: [],
			evidenceCited: [],
			newConsensus: [],
			newDivergence: [],
			roundSummary: "R2",
		};

		// Forward order
		const planA = replayPlan([r1, r2]);
		// Reverse order (simulating out-of-order async arrival)
		const planB = replayPlan([r2, r1]);
		expect(planA).toEqual(planB);
	});
});

describe("buildFallbackRoundAnalysis — divergence", () => {
	it("produces newDivergence when both sides disagree", () => {
		const proposerMeta: DebateMeta = {
			stance: "disagree",
			confidence: 0.8,
			keyPoints: ["proposer argues X"],
			concessions: [],
		};
		const challengerMeta: DebateMeta = {
			stance: "strongly_disagree",
			confidence: 0.9,
			keyPoints: ["challenger argues Y"],
			concessions: [],
		};
		const analysis = buildFallbackRoundAnalysis(
			1,
			proposerMeta,
			challengerMeta,
		);
		expect(analysis.newDivergence.length).toBeGreaterThan(0);
	});

	it("produces no divergence when one side agrees", () => {
		const proposerMeta: DebateMeta = {
			stance: "agree",
			confidence: 0.8,
			keyPoints: ["proposer agrees with X"],
			concessions: [],
		};
		const challengerMeta: DebateMeta = {
			stance: "disagree",
			confidence: 0.7,
			keyPoints: ["challenger disagrees on Y"],
			concessions: [],
		};
		const analysis = buildFallbackRoundAnalysis(
			1,
			proposerMeta,
			challengerMeta,
		);
		expect(analysis.newDivergence).toHaveLength(0);
	});

	it("only counts mutual concessions as consensus (first-20-char match)", () => {
		const proposerMeta: DebateMeta = {
			stance: "agree",
			confidence: 0.8,
			keyPoints: [],
			concessions: ["we should use TypeScript for the backend implementation"],
		};
		const challengerMeta: DebateMeta = {
			stance: "agree",
			confidence: 0.7,
			keyPoints: [],
			concessions: [
				"we should use TypeScript for the backend implementation indeed",
			],
		};
		const analysis = buildFallbackRoundAnalysis(
			1,
			proposerMeta,
			challengerMeta,
		);
		expect(analysis.newConsensus.length).toBeGreaterThan(0);
	});

	it("treats single-side concessions as separate, not consensus", () => {
		const proposerMeta: DebateMeta = {
			stance: "agree",
			confidence: 0.8,
			keyPoints: [],
			concessions: ["I concede point A about testing"],
		};
		const challengerMeta: DebateMeta = {
			stance: "disagree",
			confidence: 0.7,
			keyPoints: [],
			concessions: [],
		};
		const analysis = buildFallbackRoundAnalysis(
			1,
			proposerMeta,
			challengerMeta,
		);
		expect(analysis.newConsensus).not.toContain(
			"I concede point A about testing",
		);
	});
});
