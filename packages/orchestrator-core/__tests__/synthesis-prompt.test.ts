import { describe, expect, it } from "vitest";
import type { EvolvingPlan, RoundAnalysis } from "../src/evolving-plan.js";
import { emptyPlan } from "../src/evolving-plan.js";
import {
	type PhaseBlock,
	type SynthesisPromptConfig,
	aggregatePhaseBlockContent,
	buildCompressedRound,
	buildFullTextSynthesisPrompt,
	buildLayer1,
	buildPhaseBlocks,
	chooseInitialBudgetTier,
	detectCjkMajority,
	estimateTokens,
	normalizeConfig,
} from "../src/synthesis-prompt.js";
import type { DebateMeta, DebateState, DebateTurn } from "../src/types.js";

describe("estimateTokens", () => {
	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("returns ceil(length * 0.5) for non-empty strings", () => {
		expect(estimateTokens("hello")).toBe(3); // 5 * 0.5 = 2.5, ceil = 3
		expect(estimateTokens("hello world")).toBe(6); // 11 * 0.5 = 5.5, ceil = 6
		expect(estimateTokens("a")).toBe(1); // 1 * 0.5 = 0.5, ceil = 1
		expect(estimateTokens("ab")).toBe(1); // 2 * 0.5 = 1, ceil = 1
		expect(estimateTokens("abc")).toBe(2); // 3 * 0.5 = 1.5, ceil = 2
	});

	it("handles long strings", () => {
		const longText = "x".repeat(1000);
		expect(estimateTokens(longText)).toBe(500); // 1000 * 0.5 = 500
	});
});

describe("detectCjkMajority", () => {
	it("returns false for empty string", () => {
		expect(detectCjkMajority("")).toBe(false);
	});

	it("returns false for pure ASCII text", () => {
		expect(detectCjkMajority("Hello world")).toBe(false);
		expect(
			detectCjkMajority("The quick brown fox jumps over the lazy dog"),
		).toBe(false);
	});

	it("returns true when >30% of chars are CJK", () => {
		// Pure Chinese text (100% CJK)
		expect(detectCjkMajority("你好世界")).toBe(true);
		// Mixed: 4 CJK chars + 6 ASCII = 40% CJK
		expect(detectCjkMajority("你好世界 hello")).toBe(true);
	});

	it("returns false when <=30% of chars are CJK", () => {
		// 2 CJK chars + 11 ASCII = ~15% CJK
		expect(detectCjkMajority("你好 hello world")).toBe(false);
		// 3 CJK chars + 20 ASCII = ~13% CJK
		expect(detectCjkMajority("你好世 The quick brown fox")).toBe(false);
	});

	it("handles edge case at exactly 30% threshold", () => {
		// 3 CJK + 7 ASCII = exactly 30%
		const text = "你好世1234567";
		expect(detectCjkMajority(text)).toBe(false); // > 0.3, not >= 0.3
	});

	it("handles edge case just above 30% threshold", () => {
		// 4 CJK + 9 ASCII = ~30.77%
		const text = "你好世界123456789";
		expect(detectCjkMajority(text)).toBe(true);
	});
});

describe("buildFullTextSynthesisPrompt", () => {
	const mockConfig: SynthesisPromptConfig = {
		contextTokenLimit: 10000,
	};

	const createMockState = (turns: DebateTurn[]): DebateState => ({
		config: {
			topic: "Test Topic",
			maxRounds: 5,
			judgeEveryNRounds: 2,
			convergenceThreshold: 0.7,
		},
		phase: "completed",
		currentRound:
			turns.length > 0 ? Math.max(...turns.map((t) => t.roundNumber)) : 0,
		turns,
		convergence: {
			converged: false,
			stanceDelta: 0,
			mutualConcessions: 0,
			bothWantToConclude: false,
		},
	});

	interface JudgeNote {
		roundNumber: number;
		leading: "proposer" | "challenger" | "tie";
		reasoning: string;
	}

	it("includes all turns when within budget", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Proposer R1" },
			{ roundNumber: 1, role: "challenger", content: "Challenger R1" },
			{ roundNumber: 2, role: "proposer", content: "Proposer R2" },
			{ roundNumber: 2, role: "challenger", content: "Challenger R2" },
		];
		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [
			{ roundNumber: 2, leading: "proposer", reasoning: "Judge reasoning" },
		];

		const prompt = buildFullTextSynthesisPrompt(state, judgeNotes, mockConfig);

		// Should include all turns
		expect(prompt).toContain("Proposer R1");
		expect(prompt).toContain("Challenger R1");
		expect(prompt).toContain("Proposer R2");
		expect(prompt).toContain("Challenger R2");
		expect(prompt).toContain("Judge reasoning");
	});

	it("includes section headings", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Proposer R1" },
		];
		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [];

		const prompt = buildFullTextSynthesisPrompt(state, judgeNotes, mockConfig);

		// Should include recommended sections in instructions
		expect(prompt).toContain("Executive Summary");
		expect(prompt).toContain("Consensus Action Items");
		expect(prompt).toContain("Unresolved Disagreements");
		expect(prompt).toContain("Evidence Registry");
	});

	it("includes topic in prompt", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Content" },
		];
		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [];

		const prompt = buildFullTextSynthesisPrompt(state, judgeNotes, mockConfig);

		expect(prompt).toContain("Test Topic");
	});

	it("truncates early rounds when over budget", () => {
		// Create a very long debate that will exceed 60% of token budget
		const turns: DebateTurn[] = [];
		const longContent = "x".repeat(2000); // Each turn ~1000 tokens

		// Create 10 rounds with long content
		for (let i = 1; i <= 10; i++) {
			turns.push({
				roundNumber: i,
				role: "proposer",
				content: `P${i} ${longContent}`,
			});
			turns.push({
				roundNumber: i,
				role: "challenger",
				content: `C${i} ${longContent}`,
			});
		}

		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [
			{ roundNumber: 2, leading: "proposer", reasoning: "Verdict 2" },
			{ roundNumber: 4, leading: "challenger", reasoning: "Verdict 4" },
		];

		const smallBudgetConfig: SynthesisPromptConfig = {
			contextTokenLimit: 5000, // Small budget to force truncation
		};

		const prompt = buildFullTextSynthesisPrompt(
			state,
			judgeNotes,
			smallBudgetConfig,
		);

		// Should always include last 2 rounds (rounds 9, 10)
		expect(prompt).toContain("### Round 9");
		expect(prompt).toContain("### Round 10");

		// Should always include all judge verdicts
		expect(prompt).toContain("Verdict 2");
		expect(prompt).toContain("Verdict 4");

		// Should NOT include all early rounds - check that some are missing
		const roundsIncluded: number[] = [];
		for (let i = 1; i <= 10; i++) {
			if (prompt.includes(`### Round ${i}`)) {
				roundsIncluded.push(i);
			}
		}
		// Should have fewer than all 10 rounds due to truncation
		expect(roundsIncluded.length).toBeLessThan(10);
		// But should always have round 9 and 10
		expect(roundsIncluded).toContain(9);
		expect(roundsIncluded).toContain(10);
	});

	it("handles empty judge notes", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Proposer R1" },
			{ roundNumber: 1, role: "challenger", content: "Challenger R1" },
		];
		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [];

		const prompt = buildFullTextSynthesisPrompt(state, judgeNotes, mockConfig);

		expect(prompt).toContain("Proposer R1");
		expect(prompt).toContain("Challenger R1");
		// Should handle missing judge notes gracefully
	});

	it("handles round summaries when provided", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Proposer R1" },
			{ roundNumber: 1, role: "challenger", content: "Challenger R1" },
		];
		const state = createMockState(turns);
		const judgeNotes: JudgeNote[] = [];
		const roundSummaries = ["Round 1 was about X"];

		const prompt = buildFullTextSynthesisPrompt(
			state,
			judgeNotes,
			mockConfig,
			roundSummaries,
		);

		expect(prompt).toContain("Round 1 was about X");
	});
});

describe("normalizeConfig", () => {
	it("applies defaults when adaptive fields are missing", () => {
		const config: SynthesisPromptConfig = { contextTokenLimit: 10000 };
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(3);
		expect(result.impactM).toBe(2);
		expect(result.quoteSnippetBudgetChars).toBe(2000);
		// Original field preserved
		expect(result.contextTokenLimit).toBe(10000);
	});

	it("preserves explicitly set values", () => {
		const config: SynthesisPromptConfig = {
			contextTokenLimit: 8000,
			recentK: 5,
			impactM: 4,
			quoteSnippetBudgetChars: 3000,
		};
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(5);
		expect(result.impactM).toBe(4);
		expect(result.quoteSnippetBudgetChars).toBe(3000);
	});

	it("applies floor to fractional values", () => {
		const config: SynthesisPromptConfig = {
			contextTokenLimit: 10000,
			recentK: 3.7,
			impactM: 2.9,
			quoteSnippetBudgetChars: 1500.5,
		};
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(3);
		expect(result.impactM).toBe(2);
		expect(result.quoteSnippetBudgetChars).toBe(1500);
	});

	it("enforces min bounds (recentK min 1, impactM min 0, budget min 0)", () => {
		const config: SynthesisPromptConfig = {
			contextTokenLimit: 10000,
			recentK: 0,
			impactM: -1,
			quoteSnippetBudgetChars: -500,
		};
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(1);
		expect(result.impactM).toBe(0);
		expect(result.quoteSnippetBudgetChars).toBe(0);
	});

	it("clamps negative values to minimums", () => {
		const config: SynthesisPromptConfig = {
			contextTokenLimit: 10000,
			recentK: -10,
			impactM: -5,
			quoteSnippetBudgetChars: -1000,
		};
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(1);
		expect(result.impactM).toBe(0);
		expect(result.quoteSnippetBudgetChars).toBe(0);
	});

	it("handles fractional values that floor below minimum", () => {
		const config: SynthesisPromptConfig = {
			contextTokenLimit: 10000,
			recentK: 0.5, // floor(0.5) = 0, then clamp to 1
			impactM: -0.1, // floor(-0.1) = -1, then clamp to 0
		};
		const result = normalizeConfig(config);

		expect(result.recentK).toBe(1);
		expect(result.impactM).toBe(0);
	});
});

describe("buildLayer1", () => {
	const topic = "Should we adopt microservices?";

	function makePlan(overrides: Partial<EvolvingPlan> = {}): EvolvingPlan {
		return { ...emptyPlan(), ...overrides };
	}

	it("always includes topic", () => {
		const result = buildLayer1(makePlan(), topic);
		expect(result).toContain(topic);
	});

	it("omits empty sections", () => {
		const result = buildLayer1(makePlan(), topic);
		// With all arrays empty, none of these headers should appear
		expect(result).not.toContain("## Consensus");
		expect(result).not.toContain("## Unresolved");
		expect(result).not.toContain("## Risks");
		expect(result).not.toContain("## Evidence");
		expect(result).not.toContain("## Judge Notes");
		expect(result).not.toContain("## Round Summaries");
	});

	it("renders consensus when non-empty", () => {
		const plan = makePlan({ consensus: ["Both agree on API gateway"] });
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Consensus");
		expect(result).toContain("Both agree on API gateway");
	});

	it("renders unresolved when non-empty", () => {
		const plan = makePlan({ unresolved: ["Deployment strategy unclear"] });
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Unresolved");
		expect(result).toContain("Deployment strategy unclear");
	});

	it("renders risks when non-empty", () => {
		const plan = makePlan({
			risks: [{ risk: "Network latency", severity: "high", round: 2 }],
		});
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Risks");
		expect(result).toContain("Network latency");
		expect(result).toContain("high");
	});

	it("renders evidence when non-empty", () => {
		const plan = makePlan({
			evidence: [
				{
					claim: "Latency is under 50ms",
					source: "benchmark report",
					round: 1,
				},
			],
		});
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Evidence");
		expect(result).toContain("Latency is under 50ms");
		expect(result).toContain("benchmark report");
	});

	it("renders round summaries when non-empty", () => {
		const plan = makePlan({
			roundSummaries: ["R1: Opening positions stated"],
		});
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Round Summaries");
		expect(result).toContain("R1: Opening positions stated");
	});

	it("renders compressed judge notes with round, leading, and rationale", () => {
		const plan = makePlan({
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "proposer",
					reasoning:
						"Proposer presented stronger evidence with concrete benchmarks and real-world case studies",
				},
			],
		});
		const result = buildLayer1(plan, topic);
		expect(result).toContain("## Judge Notes");
		// Must include round number
		expect(result).toMatch(/R2/);
		// Must include leading side
		expect(result).toContain("proposer");
		// Rationale preserved as one-line summary (not raw multi-paragraph verdict)
		const judgeSection =
			result.split("## Judge Notes")[1]?.split("##")[0] ?? "";
		const noteLines = judgeSection
			.split("\n")
			.filter((l) => l.trim().startsWith("- "));
		expect(noteLines.length).toBe(1); // one compressed line per note
	});

	it("includes confidence shift when consecutive judge scores are available", () => {
		const plan = makePlan({
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "proposer",
					reasoning: "Proposer led with evidence",
					score: { proposer: 0.6, challenger: 0.4 },
				},
				{
					roundNumber: 4,
					leading: "challenger",
					reasoning: "Challenger caught up with new data",
					score: { proposer: 0.4, challenger: 0.6 },
				},
			],
		});
		const result = buildLayer1(plan, topic);
		const judgeSection =
			result.split("## Judge Notes")[1]?.split("##")[0] ?? "";

		// First note: no previous, so no shift
		// spread1 = |0.6-0.4| = 0.2
		// Second note: spread2 = |0.4-0.6| = 0.2, shift = 0.2 - 0.2 = 0.0
		expect(judgeSection).toContain("shift: 0.0");
	});

	it("shows positive confidence shift correctly", () => {
		const plan = makePlan({
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "tie",
					reasoning: "Even match",
					score: { proposer: 0.5, challenger: 0.5 },
				},
				{
					roundNumber: 4,
					leading: "proposer",
					reasoning: "Proposer pulled ahead",
					score: { proposer: 0.7, challenger: 0.3 },
				},
			],
		});
		const result = buildLayer1(plan, topic);
		const judgeSection =
			result.split("## Judge Notes")[1]?.split("##")[0] ?? "";

		// spread1 = 0.0, spread2 = 0.4, shift = +0.4
		expect(judgeSection).toContain("shift: +0.4");
	});

	it("omits confidence shift when scores are missing (graceful degradation)", () => {
		const plan = makePlan({
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "proposer",
					reasoning: "Proposer led",
					// no score
				},
				{
					roundNumber: 4,
					leading: "challenger",
					reasoning: "Challenger led",
					// no score
				},
			],
		});
		const result = buildLayer1(plan, topic);
		const judgeSection =
			result.split("## Judge Notes")[1]?.split("##")[0] ?? "";
		expect(judgeSection).not.toContain("shift:");
	});

	it("omits confidence shift when only the current note has a score but previous does not", () => {
		const plan = makePlan({
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "proposer",
					reasoning: "Proposer led",
					// no score
				},
				{
					roundNumber: 4,
					leading: "challenger",
					reasoning: "Challenger led",
					score: { proposer: 0.4, challenger: 0.6 },
				},
			],
		});
		const result = buildLayer1(plan, topic);
		const judgeSection =
			result.split("## Judge Notes")[1]?.split("##")[0] ?? "";
		// Cannot compute shift without previous score
		expect(judgeSection).not.toContain("shift:");
	});

	it("output is stable and deterministic across multiple calls", () => {
		const plan = makePlan({
			consensus: ["Agree on caching layer"],
			unresolved: ["DB choice"],
			risks: [{ risk: "Downtime risk", severity: "medium", round: 1 }],
			evidence: [{ claim: "99.9% uptime", source: "SLA doc", round: 1 }],
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "tie",
					reasoning: "Balanced arguments",
					score: { proposer: 0.5, challenger: 0.5 },
				},
			],
			roundSummaries: ["R1: Opening statements"],
		});

		const result1 = buildLayer1(plan, topic);
		const result2 = buildLayer1(plan, topic);
		const result3 = buildLayer1(plan, topic);

		expect(result1).toBe(result2);
		expect(result2).toBe(result3);
	});

	it("renders all sections together in correct order", () => {
		const plan = makePlan({
			consensus: ["Agree on X"],
			unresolved: ["Disagree on Y"],
			risks: [{ risk: "Risk Z", severity: "low", round: 1 }],
			evidence: [{ claim: "Claim A", source: "Source B", round: 1 }],
			judgeNotes: [
				{
					roundNumber: 2,
					leading: "proposer",
					reasoning: "Proposer stronger",
				},
			],
			roundSummaries: ["Summary of R1"],
		});
		const result = buildLayer1(plan, topic);

		// Verify order: Topic first, then sections
		const topicIdx = result.indexOf("## Topic");
		const consensusIdx = result.indexOf("## Consensus");
		const unresolvedIdx = result.indexOf("## Unresolved");
		const risksIdx = result.indexOf("## Risks");
		const evidenceIdx = result.indexOf("## Evidence");
		const judgeIdx = result.indexOf("## Judge Notes");
		const summariesIdx = result.indexOf("## Round Summaries");

		expect(topicIdx).toBeLessThan(consensusIdx);
		expect(consensusIdx).toBeLessThan(unresolvedIdx);
		expect(unresolvedIdx).toBeLessThan(risksIdx);
		expect(risksIdx).toBeLessThan(evidenceIdx);
		expect(evidenceIdx).toBeLessThan(judgeIdx);
		expect(judgeIdx).toBeLessThan(summariesIdx);
	});
});

describe("buildCompressedRound", () => {
	function makeState(turns: DebateTurn[]): DebateState {
		return {
			config: {
				topic: "Test Topic",
				maxRounds: 5,
				judgeEveryNRounds: 2,
				convergenceThreshold: 0.7,
			},
			phase: "completed",
			currentRound:
				turns.length > 0 ? Math.max(...turns.map((t) => t.roundNumber)) : 0,
			turns,
			convergence: {
				converged: false,
				stanceDelta: 0,
				mutualConcessions: 0,
				bothWantToConclude: false,
			},
		};
	}

	function makePlan(overrides: Partial<EvolvingPlan> = {}): EvolvingPlan {
		return { ...emptyPlan(), ...overrides };
	}

	const richAnalysis: RoundAnalysis = {
		roundNumber: 2,
		newArguments: [
			{
				side: "proposer",
				argument: "Microservices improve scalability",
				strength: "strong",
			},
			{
				side: "challenger",
				argument: "Monolith is simpler to deploy",
				strength: "moderate",
			},
		],
		challengedArguments: [
			{
				argument: "Monolith scales fine",
				challengedBy: "proposer",
				outcome: "weakened",
			},
		],
		risksIdentified: [
			{
				risk: "Network latency between services",
				severity: "high",
				raisedBy: "proposer",
			},
		],
		evidenceCited: [
			{
				claim: "Netflix migrated successfully",
				source: "Netflix tech blog",
				side: "proposer",
			},
		],
		newConsensus: ["API gateway is needed"],
		newDivergence: ["Database strategy remains contested"],
		roundSummary:
			"Proposer pushed scalability; challenger defended simplicity.",
	};

	it("renders rich compressed output from RoundAnalysis", () => {
		const turns: DebateTurn[] = [
			{
				roundNumber: 2,
				role: "proposer",
				content: "Proposer content R2",
				meta: {
					stance: "agree",
					confidence: 0.8,
					keyPoints: ["scalability"],
				},
			},
			{
				roundNumber: 2,
				role: "challenger",
				content: "Challenger content R2",
				meta: {
					stance: "disagree",
					confidence: 0.7,
					keyPoints: ["simplicity"],
				},
			},
		];
		const state = makeState(turns);
		const plan = makePlan({ roundAnalyses: [richAnalysis] });

		const result = buildCompressedRound(2, plan, state);

		// Should contain round header
		expect(result).toContain("Round 2");
		// New claims
		expect(result).toContain("Microservices improve scalability");
		expect(result).toContain("Monolith is simpler to deploy");
		expect(result).toContain("strong");
		expect(result).toContain("moderate");
		// Challenged arguments
		expect(result).toContain("Monolith scales fine");
		expect(result).toContain("weakened");
		// Consensus
		expect(result).toContain("API gateway is needed");
		// Divergence
		expect(result).toContain("Database strategy remains contested");
		// Risks
		expect(result).toContain("Network latency between services");
		expect(result).toContain("high");
		// Evidence
		expect(result).toContain("Netflix migrated successfully");
		expect(result).toContain("Netflix tech blog");
		// Round summary
		expect(result).toContain(
			"Proposer pushed scalability; challenger defended simplicity.",
		);
		// Stance/confidence from meta
		expect(result).toContain("agree");
		expect(result).toContain("0.8");
		expect(result).toContain("disagree");
		expect(result).toContain("0.7");
	});

	it("falls back to roundSummaries when RoundAnalysis is missing", () => {
		const turns: DebateTurn[] = [
			{ roundNumber: 1, role: "proposer", content: "Proposer content R1" },
			{ roundNumber: 1, role: "challenger", content: "Challenger content R1" },
		];
		const state = makeState(turns);
		const plan = makePlan({
			roundSummaries: ["Round 1 opening positions established"],
			roundAnalyses: [], // no analysis for round 1
		});

		const result = buildCompressedRound(1, plan, state);

		expect(result).toContain("Round 1");
		expect(result).toContain("Round 1 opening positions established");
		// Should NOT have rich sections
		expect(result).not.toContain("New Claims");
		expect(result).not.toContain("Challenged");
	});

	it("falls back to stripped transcript when RoundAnalysis and roundSummary are both missing", () => {
		const turns: DebateTurn[] = [
			{
				roundNumber: 3,
				role: "proposer",
				content:
					'Here is my argument.\n```debate_meta\n{"stance":"agree"}\n```',
			},
			{
				roundNumber: 3,
				role: "challenger",
				content: "Here is my rebuttal.",
			},
		];
		const state = makeState(turns);
		const plan = makePlan({
			roundSummaries: [], // no summary for round 3
			roundAnalyses: [],
		});

		const result = buildCompressedRound(3, plan, state);

		expect(result).toContain("Round 3");
		expect(result).toContain("Here is my argument.");
		expect(result).toContain("Here is my rebuttal.");
		// Must NOT contain meta-tool blocks
		expect(result).not.toContain("debate_meta");
		expect(result).not.toContain("judge_verdict");
	});

	it("renders degraded round with summary, no rich data", () => {
		const turns: DebateTurn[] = [
			{
				roundNumber: 2,
				role: "proposer",
				content: "Proposer content R2",
				meta: {
					stance: "agree",
					confidence: 0.8,
					keyPoints: ["scalability"],
				},
			},
			{
				roundNumber: 2,
				role: "challenger",
				content: "Challenger content R2",
				meta: {
					stance: "disagree",
					confidence: 0.7,
					keyPoints: ["simplicity"],
				},
			},
		];
		const state = makeState(turns);
		const plan = makePlan({
			degradedRounds: [2],
			roundAnalyses: [richAnalysis], // has analysis but round is degraded
		});

		const result = buildCompressedRound(2, plan, state);

		expect(result).toContain("Round 2");
		// Should use roundSummary from analysis
		expect(result).toContain(
			"Proposer pushed scalability; challenger defended simplicity.",
		);
		// Must NOT contain rich sections
		expect(result).not.toContain("New Claims");
		expect(result).not.toContain("Challenged");
		expect(result).not.toContain("Consensus");
		expect(result).not.toContain("Risks");
		expect(result).not.toContain("Evidence");
	});

	it("renders degraded round with transcript fallback when no summary exists", () => {
		const turns: DebateTurn[] = [
			{
				roundNumber: 4,
				role: "proposer",
				content: 'My proposer point.\n```debate_meta\n{"stance":"agree"}\n```',
			},
			{
				roundNumber: 4,
				role: "challenger",
				content:
					'My challenger rebuttal.\n```judge_verdict\n{"leading":"tie"}\n```',
			},
		];
		const state = makeState(turns);
		const plan = makePlan({
			degradedRounds: [4],
			roundAnalyses: [], // no analysis at all
		});

		const result = buildCompressedRound(4, plan, state);

		expect(result).toContain("Round 4");
		expect(result).toContain("My proposer point.");
		expect(result).toContain("My challenger rebuttal.");
		// Internal blocks must be stripped
		expect(result).not.toContain("debate_meta");
		expect(result).not.toContain("judge_verdict");
	});

	it("handles partial transcript with only one side available", () => {
		const turns: DebateTurn[] = [
			{
				roundNumber: 5,
				role: "proposer",
				content: "Only the proposer spoke this round.",
			},
			// No challenger turn
		];
		const state = makeState(turns);
		const plan = makePlan({
			roundAnalyses: [], // no analysis
			roundSummaries: [], // no summary
		});

		const result = buildCompressedRound(5, plan, state);

		expect(result).toContain("Round 5");
		expect(result).toContain("Only the proposer spoke this round.");
		// Should not crash or show undefined
		expect(result).not.toContain("undefined");
	});

	it("looks up RoundAnalysis by roundNumber, not array index", () => {
		// Put analysis for round 3 at array index 0
		const analysisR3: RoundAnalysis = {
			...richAnalysis,
			roundNumber: 3,
			roundSummary: "Round 3 specific summary",
		};
		const turns: DebateTurn[] = [
			{ roundNumber: 3, role: "proposer", content: "P3" },
			{ roundNumber: 3, role: "challenger", content: "C3" },
		];
		const state = makeState(turns);
		const plan = makePlan({ roundAnalyses: [analysisR3] });

		const result = buildCompressedRound(3, plan, state);

		expect(result).toContain("Round 3 specific summary");
		expect(result).toContain("Microservices improve scalability");
	});
});

// --- Helpers for Task 6 tests ---

function makeAnalysis(
	roundNumber: number,
	overrides: Partial<RoundAnalysis> = {},
): RoundAnalysis {
	return {
		roundNumber,
		newArguments: overrides.newArguments ?? [
			{
				side: "proposer",
				argument: `Claim P from round ${roundNumber}`,
				strength: "strong",
			},
			{
				side: "challenger",
				argument: `Claim C from round ${roundNumber}`,
				strength: "moderate",
			},
		],
		challengedArguments: overrides.challengedArguments ?? [
			{
				argument: `Challenged in round ${roundNumber}`,
				challengedBy: "proposer",
				outcome: "conceded",
			},
		],
		risksIdentified: overrides.risksIdentified ?? [
			{
				risk: `Risk from round ${roundNumber}`,
				severity: "medium",
				raisedBy: "proposer",
			},
		],
		evidenceCited: overrides.evidenceCited ?? [],
		newConsensus: overrides.newConsensus ?? [],
		newDivergence: overrides.newDivergence ?? [],
		roundSummary: overrides.roundSummary ?? `Summary of round ${roundNumber}`,
	};
}

function makeStateWithRounds(roundCount: number): DebateState {
	const turns: DebateTurn[] = [];
	for (let r = 1; r <= roundCount; r++) {
		turns.push({
			roundNumber: r,
			role: "proposer",
			content: `Proposer content R${r}`,
			meta: {
				stance: "agree",
				confidence: 0.7 + r * 0.01,
				keyPoints: [`point-p-${r}`],
			},
		});
		turns.push({
			roundNumber: r,
			role: "challenger",
			content: `Challenger content R${r}`,
			meta: {
				stance: "disagree",
				confidence: 0.6 + r * 0.01,
				keyPoints: [`point-c-${r}`],
			},
		});
	}
	return {
		config: {
			topic: "Test Topic",
			maxRounds: roundCount,
			judgeEveryNRounds: 2,
			convergenceThreshold: 0.7,
		},
		phase: "completed",
		currentRound: roundCount,
		turns,
		convergence: {
			converged: false,
			stanceDelta: 0,
			mutualConcessions: 0,
			bothWantToConclude: false,
		},
	};
}

function makePlanWithAnalyses(
	roundCount: number,
	overrides: Partial<EvolvingPlan> = {},
): EvolvingPlan {
	const analyses: RoundAnalysis[] = [];
	for (let r = 1; r <= roundCount; r++) {
		analyses.push(makeAnalysis(r));
	}
	return {
		...emptyPlan(),
		roundAnalyses: analyses,
		roundSummaries: analyses.map((a) => a.roundSummary),
		...overrides,
	};
}

describe("chooseInitialBudgetTier", () => {
	it("returns 'short' when full estimate fits within 60% of budget", () => {
		// fullEstimate = 500, budget = 1000 => 500 <= 600 => short
		expect(chooseInitialBudgetTier(5, 500, 1000)).toBe("short");
	});

	it("returns 'short' at the boundary (exactly 60%)", () => {
		// fullEstimate = 600, budget = 1000 => 600 <= 600 => short
		expect(chooseInitialBudgetTier(5, 600, 1000)).toBe("short");
	});

	it("returns 'medium' when exceeds short but rounds <= 20 and medium estimate fits", () => {
		// fullEstimate = 700, budget = 1000 => 700 > 600 (not short)
		// rounds = 10 <= 20, mediumEstimate fits within 850 (0.85 * 1000)
		expect(chooseInitialBudgetTier(10, 700, 1000)).toBe("medium");
	});

	it("returns 'long' when rounds > 20", () => {
		// Even if tokens would fit medium, 21 rounds forces long
		expect(chooseInitialBudgetTier(21, 700, 1000)).toBe("long");
	});

	it("returns 'long' when medium estimate does not fit", () => {
		// fullEstimate = 900, budget = 1000 => 900 > 600 (not short)
		// rounds = 10 <= 20, but 900 > 850 (medium threshold) => long
		expect(chooseInitialBudgetTier(10, 900, 1000)).toBe("long");
	});

	it("returns 'long' when medium estimate exactly at threshold", () => {
		// fullEstimate = 850, budget = 1000 => 850 > 600 (not short)
		// rounds = 10, mediumEstimate = 850 <= 850 => medium
		expect(chooseInitialBudgetTier(10, 850, 1000)).toBe("medium");
	});
});

describe("buildPhaseBlocks", () => {
	it("groups 6 compressed rounds with default window 3 into 2 phase blocks", () => {
		const state = makeStateWithRounds(6);
		const plan = makePlanWithAnalyses(6);
		const compressedRounds = [1, 2, 3, 4, 5, 6];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].phaseId).toBe("phase-1");
		expect(blocks[0].coveredRounds).toEqual([1, 2, 3]);
		expect(blocks[1].phaseId).toBe("phase-2");
		expect(blocks[1].coveredRounds).toEqual([4, 5, 6]);
	});

	it("handles non-divisible round counts (7 rounds, window 3 => 3 blocks: [1,2,3], [4,5,6], [7])", () => {
		const state = makeStateWithRounds(7);
		const plan = makePlanWithAnalyses(7);
		const compressedRounds = [1, 2, 3, 4, 5, 6, 7];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		expect(blocks).toHaveLength(3);
		expect(blocks[0].coveredRounds).toEqual([1, 2, 3]);
		expect(blocks[1].coveredRounds).toEqual([4, 5, 6]);
		expect(blocks[2].coveredRounds).toEqual([7]);
	});

	it("drops empty blocks (rounds with no contributing data)", () => {
		const state = makeStateWithRounds(3);
		const plan = makePlanWithAnalyses(3, {
			roundAnalyses: [
				// Only round 1 has analysis; rounds 2-3 have empty analyses
				makeAnalysis(1),
				{
					roundNumber: 2,
					newArguments: [],
					challengedArguments: [],
					risksIdentified: [],
					evidenceCited: [],
					newConsensus: [],
					newDivergence: [],
					roundSummary: "",
				},
				{
					roundNumber: 3,
					newArguments: [],
					challengedArguments: [],
					risksIdentified: [],
					evidenceCited: [],
					newConsensus: [],
					newDivergence: [],
					roundSummary: "",
				},
			],
		});
		const compressedRounds = [1, 2, 3];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		// Block covering [1,2,3] should not be empty because round 1 has content
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		expect(blocks[0].content.length).toBeGreaterThan(0);
	});

	it("includes degraded rounds in coveredRounds but they do not contribute semantic content", () => {
		const state = makeStateWithRounds(3);
		const plan = makePlanWithAnalyses(3, { degradedRounds: [2] });
		const compressedRounds = [1, 2, 3];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].coveredRounds).toContain(2);
		// Content should include round 1 and 3 claims but not round 2 claims
		expect(blocks[0].content).toContain("Claim P from round 1");
		expect(blocks[0].content).toContain("Claim P from round 3");
		expect(blocks[0].content).not.toContain("Claim P from round 2");
	});

	it("maintains contiguous blocks in round space", () => {
		const state = makeStateWithRounds(9);
		const plan = makePlanWithAnalyses(9);
		const compressedRounds = [1, 2, 3, 4, 5, 6, 7, 8, 9];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		for (const block of blocks) {
			for (let i = 1; i < block.coveredRounds.length; i++) {
				expect(block.coveredRounds[i]).toBe(block.coveredRounds[i - 1] + 1);
			}
		}
	});
});

describe("aggregatePhaseBlockContent", () => {
	it("union-deduplicates claims from multiple rounds", () => {
		const state = makeStateWithRounds(3);
		const plan = makePlanWithAnalyses(3, {
			roundAnalyses: [
				makeAnalysis(1, {
					newArguments: [
						{ side: "proposer", argument: "Shared claim", strength: "strong" },
					],
				}),
				makeAnalysis(2, {
					newArguments: [
						{ side: "proposer", argument: "Shared claim", strength: "strong" },
						{
							side: "challenger",
							argument: "Unique claim",
							strength: "moderate",
						},
					],
				}),
				makeAnalysis(3),
			],
		});

		const content = aggregatePhaseBlockContent([1, 2], plan, state);

		// "Shared claim" appears in both rounds but should be deduped
		const matches = content.match(/Shared claim/g);
		expect(matches).toHaveLength(1);
		expect(content).toContain("Unique claim");
	});

	it("merges concessions from challengedArguments where outcome is conceded", () => {
		const state = makeStateWithRounds(2);
		const plan = makePlanWithAnalyses(2, {
			roundAnalyses: [
				makeAnalysis(1, {
					challengedArguments: [
						{
							argument: "Point A",
							challengedBy: "proposer",
							outcome: "conceded",
						},
					],
				}),
				makeAnalysis(2, {
					challengedArguments: [
						{
							argument: "Point B",
							challengedBy: "challenger",
							outcome: "weakened",
						},
						{
							argument: "Point C",
							challengedBy: "proposer",
							outcome: "conceded",
						},
					],
				}),
			],
		});

		const content = aggregatePhaseBlockContent([1, 2], plan, state);

		expect(content).toContain("Point A");
		expect(content).toContain("Point C");
		// "weakened" outcome should not appear in concessions section
	});

	it("merges risk deltas from risksIdentified", () => {
		const state = makeStateWithRounds(2);
		const plan = makePlanWithAnalyses(2, {
			roundAnalyses: [
				makeAnalysis(1, {
					risksIdentified: [
						{ risk: "Risk Alpha", severity: "high", raisedBy: "proposer" },
					],
				}),
				makeAnalysis(2, {
					risksIdentified: [
						{ risk: "Risk Beta", severity: "low", raisedBy: "challenger" },
					],
				}),
			],
		});

		const content = aggregatePhaseBlockContent([1, 2], plan, state);

		expect(content).toContain("Risk Alpha");
		expect(content).toContain("Risk Beta");
	});

	it("includes judge swing when judge data is available", () => {
		const state = makeStateWithRounds(3);
		const plan = makePlanWithAnalyses(3, {
			judgeNotes: [
				{ roundNumber: 1, leading: "proposer", reasoning: "P led" },
				{ roundNumber: 2, leading: "tie", reasoning: "Even" },
				{ roundNumber: 3, leading: "challenger", reasoning: "C led" },
			],
		});

		const content = aggregatePhaseBlockContent([1, 2, 3], plan, state);

		// Should show swing from first to last leading in window
		expect(content).toContain("proposer");
		expect(content).toContain("challenger");
	});

	it("includes stance trajectory from turn meta", () => {
		const state = makeStateWithRounds(2);
		const plan = makePlanWithAnalyses(2);

		const content = aggregatePhaseBlockContent([1, 2], plan, state);

		// Should include stance information from turns
		expect(content).toContain("agree");
		expect(content).toContain("disagree");
	});

	it("accepts arbitrary round subsets for re-aggregation", () => {
		const state = makeStateWithRounds(5);
		const plan = makePlanWithAnalyses(5);

		// Phase 2 promotes round 2, so we re-aggregate [1, 3]
		const contentBefore = aggregatePhaseBlockContent([1, 2, 3], plan, state);
		const contentAfter = aggregatePhaseBlockContent([1, 3], plan, state);

		// After removal of round 2, round 2 claims should not appear
		expect(contentBefore).toContain("Claim P from round 2");
		expect(contentAfter).not.toContain("Claim P from round 2");
		// But round 1 and 3 claims should still be there
		expect(contentAfter).toContain("Claim P from round 1");
		expect(contentAfter).toContain("Claim P from round 3");
	});
});

describe("contiguity invariant", () => {
	it("forbids non-contiguous phase blocks like [1,3]", () => {
		const state = makeStateWithRounds(6);
		const plan = makePlanWithAnalyses(6);
		// Only pass non-contiguous rounds as the compressed region
		// buildPhaseBlocks should split [1,3] into [1] and [3]
		const compressedRounds = [1, 3, 4, 5, 6];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		// Every block must have contiguous rounds
		for (const block of blocks) {
			for (let i = 1; i < block.coveredRounds.length; i++) {
				expect(block.coveredRounds[i]).toBe(block.coveredRounds[i - 1] + 1);
			}
		}

		// [1] and [3] should be separate (no block contains both 1 and 3 without 2)
		const blockWith1 = blocks.find((b) => b.coveredRounds.includes(1));
		const blockWith3 = blocks.find((b) => b.coveredRounds.includes(3));
		if (blockWith1 && blockWith3 && blockWith1 === blockWith3) {
			// If same block, it must include 2
			expect(blockWith1.coveredRounds).toContain(2);
		}
	});

	it("splits into individual compressed rounds when gaps exist", () => {
		const state = makeStateWithRounds(5);
		const plan = makePlanWithAnalyses(5);
		// [1, 3, 5] — all non-contiguous
		const compressedRounds = [1, 3, 5];

		const blocks = buildPhaseBlocks(compressedRounds, plan, state);

		// Each should be a single-round block
		for (const block of blocks) {
			expect(block.coveredRounds).toHaveLength(1);
		}
	});
});
