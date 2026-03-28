import type { TurnRecord } from "@crossfire/adapter-core";
// packages/orchestrator-core/__tests__/context-builder.test.ts
import { describe, expect, it } from "vitest";
import {
	buildIncrementalPrompt,
	buildInitialPrompt,
	buildJudgeIncrementalPrompt,
	buildJudgeInitialPrompt,
	buildTranscriptRecoveryPrompt,
	defaultSystemPrompt,
	normalizeWhitespace,
	truncate,
	truncateWithHeadTail,
} from "../src/context-builder.js";

describe("truncate", () => {
	it("returns text unchanged when under limit", () => {
		expect(truncate("short", 100)).toBe("short");
	});

	it("truncates and appends ellipsis when over limit", () => {
		expect(truncate("hello world", 5)).toBe("hello...");
	});

	it("handles exact length", () => {
		expect(truncate("exact", 5)).toBe("exact");
	});
});

describe("normalizeWhitespace", () => {
	it("collapses 3+ consecutive newlines to 2", () => {
		expect(normalizeWhitespace("a\n\n\nb")).toBe("a\n\nb");
	});

	it("collapses 2+ consecutive spaces to 1", () => {
		expect(normalizeWhitespace("a   b")).toBe("a b");
	});

	it("trims leading/trailing whitespace", () => {
		expect(normalizeWhitespace("  hello  ")).toBe("hello");
	});

	it("handles mixed issues", () => {
		expect(normalizeWhitespace("  a   b\n\n\n\nc  ")).toBe("a b\n\nc");
	});
});

describe("truncateWithHeadTail", () => {
	it("returns text unchanged when under limit", () => {
		expect(truncateWithHeadTail("short text", 100)).toBe("short text");
	});

	it("splits into head 60% and tail 40% with marker", () => {
		const text = "A".repeat(100);
		const result = truncateWithHeadTail(text, 50);
		expect(result).toContain("[...truncated...]");
		const parts = result.split("[...truncated...]");
		expect(parts.length).toBe(2);
		expect(parts[0].trim().length).toBeGreaterThan(0);
		expect(parts[1].trim().length).toBeGreaterThan(0);
	});

	it("respects custom headRatio", () => {
		const text = "X".repeat(200);
		const result = truncateWithHeadTail(text, 80, 0.8);
		expect(result).toContain("[...truncated...]");
	});
});

// ===========================================================================
// Incremental Prompt Builder Tests
// ===========================================================================

describe("defaultSystemPrompt", () => {
	it("proposer: contains 'proposer', length > 50", () => {
		const prompt = defaultSystemPrompt("proposer");
		expect(prompt).toContain("proposer");
		expect(prompt.length).toBeGreaterThan(50);
	});

	it("challenger: contains 'challenger' and 'stress-test'", () => {
		const prompt = defaultSystemPrompt("challenger");
		expect(prompt).toContain("challenger");
		expect(prompt).toContain("stress-test");
	});

	it("judge: contains 'judge' and 'assess'", () => {
		const prompt = defaultSystemPrompt("judge");
		expect(prompt).toContain("judge");
		expect(prompt).toContain("assess");
	});

	it("challenger default system prompt includes verification guidance", () => {
		const prompt = defaultSystemPrompt("challenger");
		expect(prompt).toContain("verify");
	});

	it("judge default system prompt includes evidence responsibility guidance", () => {
		const prompt = defaultSystemPrompt("judge");
		expect(prompt).toContain("evidence responsibility");
	});
});

describe("buildInitialPrompt", () => {
	it("includes custom systemPrompt, topic, round 1, maxRounds, debate_meta, stance, key_points", () => {
		const prompt = buildInitialPrompt({
			role: "proposer",
			topic: "Should AI be open-sourced?",
			maxRounds: 10,
			systemPrompt: "You are a custom proposer agent.",
			schemaType: "debate_meta",
		});
		expect(prompt).toContain("You are a custom proposer agent.");
		expect(prompt).toContain("Should AI be open-sourced?");
		expect(prompt).toContain("round 1");
		expect(prompt).toContain("10");
		expect(prompt).toContain("debate_meta");
		expect(prompt).toContain("stance");
		expect(prompt).toContain("key_points");
	});

	it("uses defaultSystemPrompt when systemPrompt is undefined", () => {
		const prompt = buildInitialPrompt({
			role: "challenger",
			topic: "Test topic",
			maxRounds: 5,
			systemPrompt: undefined,
			schemaType: "debate_meta",
		});
		expect(prompt).toContain("challenger");
		expect(prompt).toContain("stress-test");
	});

	it("includes operationalPreamble when provided", () => {
		const prompt = buildInitialPrompt({
			role: "proposer",
			topic: "Test topic",
			maxRounds: 5,
			systemPrompt: "Custom system prompt.",
			schemaType: "debate_meta",
			operationalPreamble: "IMPORTANT: Use tool calls for structured output.",
		});
		expect(prompt).toContain(
			"IMPORTANT: Use tool calls for structured output.",
		);
	});

	it("uses judge_verdict schema when schemaType is judge_verdict", () => {
		const prompt = buildInitialPrompt({
			role: "proposer",
			topic: "Test",
			maxRounds: 5,
			systemPrompt: undefined,
			schemaType: "judge_verdict",
		});
		expect(prompt).toContain("judge_verdict");
		expect(prompt).toContain("leading");
		expect(prompt).toContain("score");
		expect(prompt).not.toContain("wants_to_conclude");
	});
});

describe("buildIncrementalPrompt", () => {
	it("includes Round 3/10, opponent role, full 5000-char text (no truncation), debate_meta", () => {
		const longText = "A".repeat(5000);
		const prompt = buildIncrementalPrompt({
			roundNumber: 3,
			maxRounds: 10,
			opponentRole: "challenger",
			opponentText: longText,
			schemaRefreshMode: "full",
		});
		expect(prompt).toContain("Round 3/10");
		expect(prompt).toContain("challenger");
		expect(prompt).toContain(longText);
		expect(prompt).toContain("debate_meta");
	});

	it("includes judge text when provided", () => {
		const prompt = buildIncrementalPrompt({
			roundNumber: 2,
			maxRounds: 5,
			opponentRole: "proposer",
			opponentText: "Opponent response here.",
			judgeText: "The judge thinks the challenger is ahead.",
			schemaRefreshMode: "reminder",
		});
		expect(prompt).toContain("The judge thinks the challenger is ahead.");
	});

	it("full schema mode contains stance, key_points, confidence", () => {
		const prompt = buildIncrementalPrompt({
			roundNumber: 2,
			maxRounds: 5,
			opponentRole: "proposer",
			opponentText: "Some text.",
			schemaRefreshMode: "full",
		});
		expect(prompt).toContain("stance");
		expect(prompt).toContain("key_points");
		expect(prompt).toContain("confidence");
	});

	it("reminder mode contains debate_meta but NOT strongly_agree", () => {
		const prompt = buildIncrementalPrompt({
			roundNumber: 2,
			maxRounds: 5,
			opponentRole: "proposer",
			opponentText: "Some text.",
			schemaRefreshMode: "reminder",
		});
		expect(prompt).toContain("debate_meta");
		expect(prompt).not.toContain("strongly_agree");
	});
});

describe("buildJudgeInitialPrompt", () => {
	it("includes topic, proposer text, challenger text, judge_verdict, leading, score", () => {
		const prompt = buildJudgeInitialPrompt({
			topic: "Should AI be open-sourced?",
			maxRounds: 10,
			roundNumber: 1,
			proposerText: "Proposer argues for open source.",
			challengerText: "Challenger argues against.",
			systemPrompt: undefined,
		});
		expect(prompt).toContain("Should AI be open-sourced?");
		expect(prompt).toContain("Proposer argues for open source.");
		expect(prompt).toContain("Challenger argues against.");
		expect(prompt).toContain("judge_verdict");
		expect(prompt).toContain("leading");
		expect(prompt).toContain("score");
	});
});

describe("buildJudgeIncrementalPrompt", () => {
	it("includes Round 3, proposer text, challenger text", () => {
		const prompt = buildJudgeIncrementalPrompt({
			roundNumber: 3,
			maxRounds: 10,
			proposerText: "Proposer round 3 response.",
			challengerText: "Challenger round 3 response.",
			schemaRefreshMode: "reminder",
		});
		expect(prompt).toContain("round 3");
		expect(prompt).toContain("Proposer round 3 response.");
		expect(prompt).toContain("Challenger round 3 response.");
	});
});

describe("buildTranscriptRecoveryPrompt", () => {
	it("reconstructs from transcript (system prompt, topic, all turns, schema)", () => {
		const transcript: TurnRecord[] = [
			{ roundNumber: 1, role: "proposer", content: "Pro round 1" },
			{ roundNumber: 1, role: "challenger", content: "Con round 1" },
			{ roundNumber: 2, role: "proposer", content: "Pro round 2" },
			{ roundNumber: 2, role: "challenger", content: "Con round 2" },
		];
		const prompt = buildTranscriptRecoveryPrompt({
			systemPrompt: "You are the proposer.",
			topic: "Should AI be open-sourced?",
			transcript,
			schemaType: "debate_meta",
		});
		expect(prompt).toContain("You are the proposer.");
		expect(prompt).toContain("Should AI be open-sourced?");
		expect(prompt).toContain("Pro round 1");
		expect(prompt).toContain("Con round 2");
		expect(prompt).toContain("debate_meta");
	});

	it("budgeted mode: 10 turns of 100K chars each with 50K budget", () => {
		const transcript: TurnRecord[] = [];
		for (let i = 1; i <= 10; i++) {
			transcript.push({
				roundNumber: Math.ceil(i / 2),
				role: i % 2 === 1 ? "proposer" : "challenger",
				content: "X".repeat(100_000),
			});
		}
		const prompt = buildTranscriptRecoveryPrompt({
			systemPrompt: "System prompt.",
			topic: "Topic.",
			transcript,
			schemaType: "debate_meta",
			recoveryBudgetChars: 50_000,
		});
		expect(prompt).toContain("CONTEXT RECOVERED");
		expect(prompt.length).toBeLessThan(60_000);
		// Recent turns should still be present in full
		expect(prompt).toContain("X".repeat(1000));
	});

	it("returns header only for empty transcript", () => {
		const prompt = buildTranscriptRecoveryPrompt({
			systemPrompt: "System.",
			topic: "Topic.",
			transcript: [],
			schemaType: "debate_meta",
		});
		expect(prompt).toContain("System.");
		expect(prompt).toContain("Topic.");
		expect(prompt).not.toContain("CONTEXT RECOVERED");
	});

	it("includes operationalPreamble when provided", () => {
		const transcript: TurnRecord[] = [
			{ roundNumber: 1, role: "proposer", content: "Pro round 1" },
		];
		const prompt = buildTranscriptRecoveryPrompt({
			systemPrompt: "System.",
			topic: "Topic.",
			transcript,
			schemaType: "debate_meta",
			operationalPreamble: "USE TOOL CALLS ONLY.",
		});
		expect(prompt).toContain("USE TOOL CALLS ONLY.");
	});
});
