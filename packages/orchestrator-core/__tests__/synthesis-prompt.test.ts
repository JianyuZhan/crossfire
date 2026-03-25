import { describe, expect, it } from "vitest";
import {
	type SynthesisPromptConfig,
	buildFullTextSynthesisPrompt,
	detectCjkMajority,
	estimateTokens,
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
