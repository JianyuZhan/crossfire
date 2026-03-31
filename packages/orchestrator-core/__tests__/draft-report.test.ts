import { describe, expect, it } from "vitest";
import type { DebateSummary } from "../src/director/summary-generator.js";
import {
	type AuditReport,
	type DraftReport,
	buildDraftReport,
	draftToAuditReport,
} from "../src/draft-report.js";
import {
	type EvolvingPlan,
	type RoundAnalysis,
	emptyPlan,
	updatePlan,
} from "../src/evolving-plan.js";

function makePlanWith2Rounds(): EvolvingPlan {
	let plan = emptyPlan();
	const r1: RoundAnalysis = {
		roundNumber: 1,
		newArguments: [
			{ side: "proposer", argument: "Use microservices", strength: "strong" },
			{
				side: "challenger",
				argument: "Monolith is simpler",
				strength: "moderate",
			},
		],
		challengedArguments: [],
		risksIdentified: [
			{ risk: "complexity", severity: "high", raisedBy: "challenger" },
		],
		evidenceCited: [
			{
				claim: "Netflix uses microservices",
				source: "case study",
				side: "proposer",
			},
		],
		newConsensus: [],
		newDivergence: ["Architecture choice"],
		roundSummary: "R1: Initial positions",
	};
	plan = updatePlan(plan, r1);

	const r2: RoundAnalysis = {
		roundNumber: 2,
		newArguments: [],
		challengedArguments: [
			{
				argument: "Use microservices",
				challengedBy: "too complex for team size",
				outcome: "weakened",
			},
		],
		risksIdentified: [],
		evidenceCited: [],
		newConsensus: ["Both agree on API-first design"],
		newDivergence: [],
		roundSummary: "R2: Proposer concedes on complexity",
	};
	plan = updatePlan(plan, r2);
	plan = {
		...plan,
		judgeNotes: [
			{
				roundNumber: 2,
				leading: "challenger",
				reasoning: "Valid cost concerns",
			},
		],
	};
	return plan;
}

describe("buildDraftReport", () => {
	it("is deterministic for the same input", () => {
		const plan = makePlanWith2Rounds();
		const a = buildDraftReport(plan);
		const b = buildDraftReport(plan);
		expect(a).toEqual(b);
	});

	it("separates consensus and unresolved items", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		expect(draft.consensus.length).toBeGreaterThan(0);
		expect(draft.unresolved.length).toBeGreaterThan(0);
	});

	it("builds argument trajectories with correct status", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		expect(draft.argumentTrajectories.length).toBeGreaterThan(0);
		const microservicesArg = draft.argumentTrajectories.find((t) =>
			t.text.includes("microservices"),
		);
		expect(microservicesArg?.finalStatus).toBe("unresolved");
	});

	it("includes judge notes when available", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		expect(draft.judgeNotes).toHaveLength(1);
	});

	it("sets generationQuality to full when no degraded rounds", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		expect(draft.generationQuality).toBe("full");
	});

	it("sets generationQuality to draft-filled when degraded rounds exist", () => {
		const plan = { ...makePlanWith2Rounds(), degradedRounds: [1] };
		const draft = buildDraftReport(plan);
		expect(draft.generationQuality).toBe("draft-filled");
	});

	it("sorts arguments by firstRound then side then id", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const rounds = draft.argumentTrajectories.map(
			(t) => t.rounds[0]?.round ?? 0,
		);
		for (let i = 1; i < rounds.length; i++) {
			expect(rounds[i]).toBeGreaterThanOrEqual(rounds[i - 1]);
		}
	});
});

describe("draftToAuditReport", () => {
	it("produces an AuditReport with all 6 sections populated", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		expect(report.executiveSummary).toBeTruthy();
		expect(report.consensusItems.length).toBeGreaterThan(0);
		expect(report.unresolvedIssues.length).toBeGreaterThan(0);
		expect(report.argumentEvolution.length).toBeGreaterThan(0);
		expect(report.riskMatrix.length).toBeGreaterThan(0);
		expect(report.evidenceRegistry.length).toBeGreaterThan(0);
	});

	it("fills narrative fields with template text", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const item of report.consensusItems) {
			expect(item.detail).toBeTruthy();
		}
	});
});

describe("draftToAuditReport — template quality", () => {
	it("does not use generic 'Define concrete implementation steps' for nextSteps", () => {
		const plan = emptyPlan();
		plan.consensus = ["implement caching layer"];
		plan.arguments["r1-p-0"] = {
			id: "r1-p-0",
			text: "implement caching layer",
			side: "proposer",
			firstRound: 1,
			status: "reinforced",
			challenges: [],
			relatedIds: [],
		};
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const item of report.consensusItems) {
			expect(item.nextSteps).not.toBe("Define concrete implementation steps.");
		}
	});

	it("does not use 'Requires further analysis' for risk mitigation", () => {
		const plan = emptyPlan();
		plan.risks = [{ risk: "Security risk", severity: "high", round: 1 }];
		plan.arguments["r1-p-0"] = {
			id: "r1-p-0",
			text: "X",
			side: "proposer",
			firstRound: 1,
			status: "active",
			challenges: [],
			relatedIds: [],
		};
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const r of report.riskMatrix) {
			expect(r.mitigation).not.toBe("Requires further analysis.");
		}
	});

	it("does not use generic 'debate participant' for evidence usedBy", () => {
		const plan = emptyPlan();
		plan.evidence = [{ claim: "Test", source: "paper.pdf", round: 1 }];
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const ev of report.evidenceRegistry) {
			expect(ev.usedBy).not.toBe("debate participant");
		}
	});
});

function makeRichSummary(): DebateSummary {
	return {
		terminationReason: "max_rounds",
		roundsCompleted: 2,
		leading: "challenger",
		judgeScore: { proposer: 6, challenger: 8 },
		recommendedAction: "Adopt modular monolith as compromise",
		judgeAssessment:
			"The challenger exposed execution risk, but both sides converged on a narrower architecture.",
		shouldContinue: false,
		stanceTrajectory: {
			proposer: [{ round: 1, stance: "strongly_agree", confidence: 0.9 }],
			challenger: [{ round: 1, stance: "disagree", confidence: 0.8 }],
		},
		consensus: ["API-first design", "Incremental migration path"],
		unresolved: ["Service boundary granularity", "Team readiness"],
		unresolvedDetails: [
			{
				title: "Service boundary granularity",
				proposerPosition: "Prefer smaller services for future scale",
				challengerPosition:
					"Keep boundaries coarse until the team has more operational maturity",
			},
		],
		totalTurns: 4,
	};
}

describe("draftToAuditReport — with DebateSummary", () => {
	it("uses summary.recommendedAction in executive summary", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const summary = makeRichSummary();
		const report = draftToAuditReport(draft, summary);
		expect(report.executiveSummary).toContain("Adopt modular monolith");
	});

	it("merges summary.consensus into consensus items when draft is sparse", () => {
		let plan = makePlanWith2Rounds();
		plan = { ...plan, consensus: [] }; // empty plan consensus
		const draft = buildDraftReport(plan);
		const summary = makeRichSummary();
		const report = draftToAuditReport(draft, summary);
		expect(report.consensusItems.length).toBeGreaterThanOrEqual(2);
		expect(report.consensusItems.map((c) => c.title)).toContain(
			"API-first design",
		);
	});

	it("merges summary.unresolved into unresolved issues when draft is sparse", () => {
		let plan = makePlanWith2Rounds();
		plan = { ...plan, unresolved: [] }; // empty plan unresolved
		const draft = buildDraftReport(plan);
		const summary = makeRichSummary();
		const report = draftToAuditReport(draft, summary);
		expect(report.unresolvedIssues.length).toBeGreaterThanOrEqual(2);
		expect(report.unresolvedIssues.map((u) => u.title)).toContain(
			"Team readiness",
		);
	});

	it("includes leading and judgeScore in executive summary", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const summary = makeRichSummary();
		const report = draftToAuditReport(draft, summary);
		expect(report.executiveSummary).toContain("challenger");
		expect(report.executiveSummary).toMatch(/6.*8|8.*6/);
	});

	it("still works without summary (backward compat)", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		expect(report.executiveSummary).toBeTruthy();
	});

	it("does not dump long judge markdown into executive summary", () => {
		const draft = buildDraftReport(makePlanWith2Rounds());
		const report = draftToAuditReport(draft, {
			leading: "proposer",
			judgeScore: { proposer: 8.5, challenger: 3.5 },
			recommendedAction:
				"Stop the debate and consolidate the agreed actions into a final plan.",
			judgeAssessment:
				"## Round Review\n\n### Strengths\n\nThe proposer integrated valid criticism and improved the plan.",
			shouldContinue: false,
		});

		expect(report.executiveSummary).not.toContain("## Round Review");
		expect(report.executiveSummary).toContain(
			"Stop the debate and consolidate the agreed actions into a final plan.",
		);
	});

	it("uses structured unresolved details when they are available", () => {
		const draft = buildDraftReport(makePlanWith2Rounds());
		const summary = makeRichSummary();
		const report = draftToAuditReport(draft, summary);
		const issue = report.unresolvedIssues.find(
			(entry) => entry.title === "Service boundary granularity",
		);
		expect(issue?.proposerPosition).toContain("Prefer smaller services");
		expect(issue?.challengerPosition).toContain("Keep boundaries coarse");
	});
});

describe("draftToAuditReport — template quality (enriched)", () => {
	it("uses judge reasoning in executive summary when available", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		// judgeNotes has reasoning "Valid cost concerns"
		expect(report.executiveSummary).toContain("Valid cost concerns");
	});

	it("does not use 'Not discussed in debate.' for risk mitigation", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const r of report.riskMatrix) {
			expect(r.mitigation).not.toBe("Not discussed in debate.");
		}
	});

	it("does not use 'Further investigation recommended.' for suggestedExploration", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const u of report.unresolvedIssues) {
			expect(u.suggestedExploration).not.toBe(
				"Further investigation recommended.",
			);
		}
	});

	it("uses round number for evidence usedBy instead of 'unknown'", () => {
		const plan = makePlanWith2Rounds();
		const draft = buildDraftReport(plan);
		const report = draftToAuditReport(draft);
		for (const ev of report.evidenceRegistry) {
			expect(ev.usedBy).not.toBe("unknown");
			expect(ev.usedBy).toMatch(/round \d+/);
		}
	});

	it("does not fall back to 'See consensus detail above.' for next steps", () => {
		const draft = buildDraftReport(makePlanWith2Rounds());
		const report = draftToAuditReport(draft);
		for (const item of report.consensusItems) {
			expect(item.nextSteps).not.toBe("See consensus detail above.");
		}
	});
});
