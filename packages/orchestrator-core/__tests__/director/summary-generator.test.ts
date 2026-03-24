import { describe, expect, it } from "vitest";
import {
	formatFinalOutcome,
	generateActionPlanHtmlFallback,
	generateActionPlanHtmlFromDeepSummary,
	generateSummary,
} from "../../src/director/summary-generator.js";
import type { DeepSummary } from "../../src/director/summary-generator.js";
import type {
	DebateConfig,
	DebateState,
	JudgeVerdict,
} from "../../src/types.js";

const config: DebateConfig = {
	topic: "Test topic",
	maxRounds: 10,
	judgeEveryNRounds: 3,
	convergenceThreshold: 0.3,
};

function makeState(overrides: Partial<DebateState> = {}): DebateState {
	return {
		config,
		phase: "completed",
		currentRound: 3,
		turns: [],
		convergence: {
			converged: false,
			stanceDelta: 0.5,
			mutualConcessions: 0,
			bothWantToConclude: false,
		},
		terminationReason: "max-rounds",
		...overrides,
	};
}

describe("generateSummary", () => {
	it("generates summary with stance trajectory", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "A",
					meta: {
						stance: "strongly_agree",
						confidence: 0.85,
						keyPoints: ["p1"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "B",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["c1"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "A2",
					meta: {
						stance: "agree",
						confidence: 0.9,
						keyPoints: ["p2"],
						concessions: ["c1-partial"],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "B2",
					meta: {
						stance: "disagree",
						confidence: 0.65,
						keyPoints: ["c2"],
						concessions: ["p1-partial"],
						wantsToConclude: false,
					},
				},
			],
		});
		const summary = generateSummary(state, undefined);
		expect(summary.terminationReason).toBe("max-rounds");
		expect(summary.stanceTrajectory.proposer).toHaveLength(2);
		expect(summary.stanceTrajectory.challenger).toHaveLength(2);
		expect(summary.leading).toBe("proposer"); // inferred from confidence: 0.8 > 0.65
	});

	it("incorporates Judge verdict when available", () => {
		const state = makeState();
		const verdict: JudgeVerdict = {
			leading: "proposer",
			score: { proposer: 8, challenger: 6 },
			reasoning: "Proposer was stronger",
			shouldContinue: false,
		};
		const summary = generateSummary(state, verdict);
		expect(summary.leading).toBe("proposer");
		expect(summary.judgeScore).toEqual({ proposer: 8, challenger: 6 });
		expect(summary.recommendedAction).toBe("Proposer was stronger");
	});

	it("sets judge fields to null when no verdict", () => {
		const state = makeState();
		const summary = generateSummary(state, undefined);
		expect(summary.judgeScore).toBeNull();
		expect(summary.recommendedAction).toBeNull();
	});
});

describe("formatFinalOutcome", () => {
	it("produces markdown Final Outcome block", () => {
		const state = makeState({
			currentRound: 3,
			terminationReason: "judge-decision",
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "A",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["p1"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "B",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["c1"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		const verdict: JudgeVerdict = {
			leading: "proposer",
			score: { proposer: 8, challenger: 6 },
			reasoning: "Better arguments",
			shouldContinue: false,
		};
		const md = formatFinalOutcome(state, verdict);
		expect(md).toContain("## Final Outcome");
		expect(md).toContain("**Termination**: judge-decision");
		expect(md).toContain("**Leading**: proposer");
	});
});

describe("generateActionPlanHtmlFromDeepSummary", () => {
	it("produces HTML with consensus and unresolved sections", () => {
		const summary: DeepSummary = {
			consensus: [
				{
					title: "Use modular monolith",
					detail: "Both agreed on starting with monolith.",
					nextSteps: "Define module boundaries.",
				},
			],
			unresolved: [
				{
					title: "Database strategy",
					proposerPosition: "DB per service",
					challengerPosition: "Shared DB",
					risk: "Query complexity",
				},
			],
		};
		const html = generateActionPlanHtmlFromDeepSummary(
			"Microservices vs Monolith",
			summary,
			3,
		);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("Microservices vs Monolith");
		expect(html).toContain("Use modular monolith");
		expect(html).toContain("Database strategy");
		expect(html).toContain("DB per service");
		expect(html).toContain("Query complexity");
	});
});

describe("generateActionPlanHtmlFallback", () => {
	it("produces HTML from basic DebateSummary when judge deep summary fails", () => {
		const summary = {
			consensus: ["Both agree on modular approach"],
			unresolved: ["Database sharing unclear"],
			terminationReason: "max-rounds",
			roundsCompleted: 3,
			leading: "proposer",
			judgeScore: { proposer: 7, challenger: 5 },
			recommendedAction: "Adopt modular monolith",
			totalTurns: 6,
			stanceTrajectory: { proposer: [], challenger: [] },
		};
		const html = generateActionPlanHtmlFallback("Test topic", summary);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("modular approach");
	});
});
