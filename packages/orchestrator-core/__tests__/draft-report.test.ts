import { describe, expect, it } from "vitest";
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
