import { describe, expect, it } from "vitest";
import type { EvolvingPlan } from "../src/evolving-plan.js";
import { emptyPlan } from "../src/evolving-plan.js";
import {
	type SynthesisPromptConfig,
	buildFullTextSynthesisPrompt,
	buildLayer1,
	detectCjkMajority,
	estimateTokens,
	normalizeConfig,
} from "../src/synthesis-prompt.js";
import type { DebateState, DebateTurn } from "../src/types.js";

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
