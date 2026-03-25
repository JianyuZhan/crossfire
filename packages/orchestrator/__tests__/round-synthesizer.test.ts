import type { RoundAnalysis } from "@crossfire/orchestrator-core";
import { describe, expect, it } from "vitest";
import {
	type SynthesizerConfig,
	buildFinalSynthesisPrompt,
	buildRoundSynthesisPrompt,
	parseFinalSynthesisResponse,
	parseRoundAnalysisResponse,
} from "../src/round-synthesizer.js";

describe("buildRoundSynthesisPrompt", () => {
	it("includes round text and evolving plan context", () => {
		const prompt = buildRoundSynthesisPrompt({
			roundNumber: 2,
			proposerText: "Proposer argues X",
			challengerText: "Challenger argues Y",
			previousRoundSummary: "R1: Initial positions",
			planSnapshot: {
				consensus: ["agreed on A"],
				unresolved: ["disagree on B"],
			},
		});
		expect(prompt).toContain("Round 2");
		expect(prompt).toContain("Proposer argues X");
		expect(prompt).toContain("Challenger argues Y");
		expect(prompt).toContain("agreed on A");
	});
});

describe("parseRoundAnalysisResponse", () => {
	it("extracts RoundAnalysis from valid JSON response", () => {
		const response =
			'```json\n{"roundNumber":1,"newArguments":[{"side":"proposer","argument":"X","strength":"strong"}],"challengedArguments":[],"risksIdentified":[],"evidenceCited":[],"newConsensus":[],"newDivergence":[],"roundSummary":"Test"}\n```';
		const result = parseRoundAnalysisResponse(response, 1);
		expect(result).not.toBeUndefined();
		expect(result?.newArguments).toHaveLength(1);
	});

	it("returns undefined for malformed response", () => {
		const result = parseRoundAnalysisResponse("not json", 1);
		expect(result).toBeUndefined();
	});
});

describe("buildFinalSynthesisPrompt", () => {
	it("includes DraftReport data", () => {
		const prompt = buildFinalSynthesisPrompt({
			consensus: [
				{
					title: "A",
					supportingRounds: [1],
					challengesSurvived: [],
					evidence: [],
				},
			],
			unresolved: [
				{
					title: "B",
					proposerArguments: [],
					challengerArguments: [],
					relatedRisks: [],
				},
			],
			argumentTrajectories: [],
			risks: [],
			evidence: [],
			judgeNotes: [],
			generationQuality: "full",
			degradedRounds: [],
			warnings: [],
		});
		expect(prompt).toContain("Consensus");
		expect(prompt).toContain("Unresolved");
	});
});

describe("parseFinalSynthesisResponse", () => {
	it("extracts AuditReport from valid JSON response", () => {
		const json = JSON.stringify({
			executiveSummary: "Summary",
			consensusItems: [],
			unresolvedIssues: [],
			argumentEvolution: [],
			riskMatrix: [],
			evidenceRegistry: [],
		});
		const response = `\`\`\`json\n${json}\n\`\`\``;
		const result = parseFinalSynthesisResponse(response);
		expect(result).not.toBeUndefined();
		expect(result?.executiveSummary).toBe("Summary");
	});
});
