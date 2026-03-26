import type { TurnRecord } from "@crossfire/adapter-core";
// packages/orchestrator-core/__tests__/context-builder.test.ts
import { describe, expect, it } from "vitest";
import {
	buildIncrementalPrompt,
	buildInitialPrompt,
	buildJudgeIncrementalPrompt,
	buildJudgeInitialPrompt,
	buildJudgePrompt,
	buildJudgePromptContext,
	buildPromptContext,
	buildTranscriptRecoveryPrompt,
	buildTurnPrompt,
	buildTurnPromptFromState,
	defaultSystemPrompt,
	normalizeWhitespace,
	truncate,
	truncateWithHeadTail,
} from "../src/context-builder.js";
import type { DebateState } from "../src/types.js";

function makeState(overrides: Partial<DebateState> = {}): DebateState {
	return {
		config: {
			topic: "Should AI be open-sourced?",
			maxRounds: 10,
			judgeEveryNRounds: 3,
			convergenceThreshold: 0.3,
		},
		phase: "proposer-turn",
		currentRound: 1,
		turns: [],
		convergence: {
			converged: false,
			stanceDelta: 1.0,
			mutualConcessions: 0,
			bothWantToConclude: false,
		},
		...overrides,
	};
}

describe("buildTurnPrompt", () => {
	it("includes topic in prompt", () => {
		const state = makeState();
		const prompt = buildTurnPrompt(state, "proposer");
		expect(prompt).toContain("Should AI be open-sourced?");
	});

	it("includes role assignment", () => {
		const prompt = buildTurnPrompt(makeState(), "proposer");
		expect(prompt).toContain("proposer");
		expect(prompt).toContain("debate_meta");
	});

	it("includes opponent history when turns exist", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Open source is better",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["Transparency", "Innovation"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Closed source protects IP",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.85,
						keyPoints: ["IP protection", "Quality control"],
					},
				},
			],
		});
		const prompt = buildTurnPrompt(state, "proposer");
		expect(prompt).toContain("IP protection");
		expect(prompt).toContain("Quality control");
	});

	it("mentions concessions when present", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "challenger",
					content: "I concede transparency",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["IP"],
						concessions: ["Transparency is valid"],
					},
				},
			],
		});
		const prompt = buildTurnPrompt(state, "proposer");
		expect(prompt).toContain("Transparency is valid");
	});
});

describe("buildTurnPrompt with guidance", () => {
	it("injects guidance text when provided", () => {
		const state = makeState({
			currentRound: 2,
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
			],
		});
		const prompt = buildTurnPrompt(state, "challenger", {
			guidance: "Focus on cost analysis",
		});
		expect(prompt).toContain("Focus on cost analysis");
	});

	it("injects high-priority user directive format", () => {
		const state = makeState({ currentRound: 2 });
		const prompt = buildTurnPrompt(state, "proposer", {
			guidance:
				"!! USER DIRECTIVE (priority: high):\nAddress the latency concern.\nYou MUST address this directive before continuing your argument.",
		});
		expect(prompt).toContain("USER DIRECTIVE");
		expect(prompt).toContain("Address the latency concern");
	});
});

describe("buildJudgePrompt", () => {
	it("includes turn content in recent round", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Open source argument",
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Closed source argument",
				},
			],
		});
		const prompt = buildJudgePrompt(state);
		expect(prompt).toContain("Open source argument");
		expect(prompt).toContain("Closed source argument");
		expect(prompt).toContain("judge_verdict");
	});

	it("includes topic", () => {
		const state = makeState();
		const prompt = buildJudgePrompt(state);
		expect(prompt).toContain("Should AI be open-sourced?");
	});
});

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

describe("buildPromptContext", () => {
	it("returns empty longMemory for round 1 proposer", () => {
		const state = makeState();
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.topic).toBe("Should AI be open-sourced?");
		expect(ctx.roundNumber).toBe(1);
		expect(ctx.maxRounds).toBe(10);
		expect(ctx.role).toBe("proposer");
		expect(ctx.longMemory.selfStance).toBeUndefined();
		expect(ctx.longMemory.selfKeyPoints).toEqual([]);
		expect(ctx.localWindow.opponentLastTurnFull).toBeUndefined();
	});

	it("extracts stance and confidence from latest own turn", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Arg 1",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["Point A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Counter 1",
					meta: {
						stance: "disagree",
						confidence: 0.8,
						keyPoints: ["Counter A"],
					},
				},
			],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.longMemory.selfStance).toBe("strongly_agree");
		expect(ctx.longMemory.selfConfidence).toBe(0.9);
		expect(ctx.longMemory.opponentStance).toBe("disagree");
		expect(ctx.longMemory.opponentConfidence).toBe(0.8);
	});

	it("accumulates keyPoints across rounds with dedup and limit", () => {
		const turns = [];
		for (let r = 1; r <= 4; r++) {
			turns.push({
				roundNumber: r,
				role: "proposer" as const,
				content: `Arg ${r}`,
				meta: {
					stance: "agree" as const,
					confidence: 0.8,
					keyPoints: [`Point ${r}a`, `Point ${r}b`, `Point ${r}c`, "Shared"],
				},
			});
		}
		const state = makeState({ currentRound: 5, turns });
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.longMemory.selfKeyPoints.length).toBeLessThanOrEqual(12);
		expect(ctx.longMemory.selfKeyPoints).toContain("Point 4c");
	});

	it("truncates individual keyPoints to 160 chars", () => {
		const longPoint = "A".repeat(200);
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Arg",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: [longPoint],
					},
				},
			],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.longMemory.selfKeyPoints[0].length).toBeLessThanOrEqual(163);
	});

	it("extracts judgeSummary from last turn with judgeVerdict", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Arg",
					judgeVerdict: {
						leading: "proposer",
						score: { proposer: 7, challenger: 5 },
						reasoning:
							"Proposer had stronger evidence and more direct engagement.",
						shouldContinue: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Counter",
				},
			],
		});
		const ctx = buildPromptContext(state, "challenger");
		expect(ctx.longMemory.judgeSummary).toContain(
			"Proposer had stronger evidence",
		);
	});

	it("passes through directorGuidance from options", () => {
		const state = makeState();
		const ctx = buildPromptContext(state, "proposer", {
			guidance: ["Focus on cost", "Address scalability"],
		});
		expect(ctx.longMemory.directorGuidance).toEqual([
			"Focus on cost",
			"Address scalability",
		]);
	});

	it("truncates opponentLastTurnFull with head-tail", () => {
		const longContent = "X".repeat(3000);
		const state = makeState({
			currentRound: 2,
			turns: [{ roundNumber: 1, role: "challenger", content: longContent }],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.localWindow.opponentLastTurnFull!.length).toBeLessThan(3000);
		expect(ctx.localWindow.opponentLastTurnFull).toContain("[...truncated...]");
	});

	it("uses keyPoints.join for selfLastTurnSummary when available", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Full argument text here",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["Point A", "Point B"],
					},
				},
			],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.localWindow.selfLastTurnSummary).toBe("Point A; Point B");
	});

	it("falls back to truncated content for selfLastTurnSummary", () => {
		const state = makeState({
			currentRound: 2,
			turns: [{ roundNumber: 1, role: "proposer", content: "C".repeat(500) }],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.localWindow.selfLastTurnSummary!.length).toBeLessThanOrEqual(
			303,
		);
	});

	it("handles turns with undefined meta gracefully", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{ roundNumber: 1, role: "proposer", content: "No meta" },
				{ roundNumber: 1, role: "challenger", content: "Also no meta" },
			],
		});
		const ctx = buildPromptContext(state, "proposer");
		expect(ctx.longMemory.selfStance).toBeUndefined();
		expect(ctx.longMemory.selfKeyPoints).toEqual([]);
		expect(ctx.longMemory.selfConcessions).toEqual([]);
	});
});

describe("renderTurnPrompt via buildTurnPromptFromState", () => {
	it("produces 4-layer prompt for proposer", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "challenger",
					content: "Counter arg",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["Point X"],
					},
				},
			],
		});
		const prompt = buildTurnPromptFromState(state, "proposer", {
			guidance: "Focus on evidence",
		});
		expect(prompt).toContain("[TOPIC]");
		expect(prompt).toContain("[ROLE]");
		expect(prompt).toContain("[REVIEW PROGRESS]");
		expect(prompt).toContain("[LOCAL WORKING CONTEXT]");
		expect(prompt).toContain("[THIS TURN'S OBJECTIVE]");
		expect(prompt).toContain("[OUTPUT INSTRUCTIONS]");
		expect(prompt).toContain("debate_meta");
		expect(prompt).toContain("[DIRECTOR GUIDANCE]");
		expect(prompt).toContain("Focus on evidence");
	});

	it("renders challenger-specific content", () => {
		const prompt = buildTurnPromptFromState(makeState(), "challenger");
		expect(prompt).toContain("challenger");
		expect(prompt).toContain("stress-test");
	});

	it("includes user injection normal in layer 2", () => {
		const prompt = buildTurnPromptFromState(makeState(), "proposer", {
			userInjection: { text: "Consider ethics", priority: "normal" },
		});
		expect(prompt).toContain("[USER GUIDANCE]");
		expect(prompt).toContain("Consider ethics");
	});

	it("includes high-priority injection between layer 3 and 4", () => {
		const prompt = buildTurnPromptFromState(makeState(), "proposer", {
			userInjection: { text: "Address latency now", priority: "high" },
		});
		expect(prompt).toContain("[HIGH PRIORITY USER DIRECTIVE]");
		const highIdx = prompt.indexOf("[HIGH PRIORITY USER DIRECTIVE]");
		const objectiveIdx = prompt.indexOf("[THIS TURN'S OBJECTIVE]");
		expect(highIdx).toBeLessThan(objectiveIdx);
	});

	it("includes conclude mode", () => {
		const prompt = buildTurnPromptFromState(makeState(), "proposer", {
			shouldTryToConclude: true,
		});
		expect(prompt).toContain("[CONCLUSION MODE]");
	});

	it("includes language hint for CJK topics", () => {
		const state = makeState({
			config: {
				...makeState().config,
				topic: "\u4eba\u5de5\u667a\u80fd\u5e94\u8be5\u5f00\u6e90\u5417\uff1f",
			},
		});
		const prompt = buildTurnPromptFromState(state, "proposer");
		expect(prompt).toContain("[LANGUAGE]");
		expect(prompt).toContain("Chinese");
	});
});

describe("buildJudgePromptContext", () => {
	it("extracts both sides symmetrically", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Pro arg",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["Pro point"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Con arg",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["Con point"],
						concessions: ["Fair point"],
					},
				},
			],
		});
		const ctx = buildJudgePromptContext(state);
		expect(ctx.proposerStance).toBe("agree");
		expect(ctx.challengerStance).toBe("disagree");
		expect(ctx.proposerKeyPoints).toContain("Pro point");
		expect(ctx.challengerKeyPoints).toContain("Con point");
		expect(ctx.challengerConcessions).toContain("Fair point");
	});

	it("truncates latest turn content", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{ roundNumber: 1, role: "proposer", content: "P".repeat(3000) },
				{ roundNumber: 1, role: "challenger", content: "C".repeat(3000) },
			],
		});
		const ctx = buildJudgePromptContext(state);
		expect(ctx.proposerLastTurn!.length).toBeLessThan(3000);
		expect(ctx.challengerLastTurn!.length).toBeLessThan(3000);
	});

	it("computes earlyEndGuidance for non-final rounds", () => {
		const ctx = buildJudgePromptContext(makeState({ currentRound: 2 }));
		expect(ctx.earlyEndGuidance).toContain("8 rounds remaining");
	});

	it("computes earlyEndGuidance for final round", () => {
		const ctx = buildJudgePromptContext(makeState({ currentRound: 10 }));
		expect(ctx.earlyEndGuidance).toContain("final evaluation");
	});
});

describe("buildJudgePrompt (new format)", () => {
	it("uses structured summary, not full transcript", () => {
		const state = makeState({
			currentRound: 3,
			turns: [
				{ roundNumber: 1, role: "proposer", content: "Round 1 Pro" },
				{ roundNumber: 1, role: "challenger", content: "Round 1 Con" },
				{ roundNumber: 2, role: "proposer", content: "Round 2 Pro" },
				{ roundNumber: 2, role: "challenger", content: "Round 2 Con" },
				{ roundNumber: 3, role: "proposer", content: "Round 3 Pro" },
				{ roundNumber: 3, role: "challenger", content: "Round 3 Con" },
			],
		});
		const prompt = buildJudgePrompt(state);
		expect(prompt).toContain("[REVIEW SUMMARY]");
		expect(prompt).toContain("[RECENT ROUND CONTENT]");
		expect(prompt).toContain("judge_verdict");
		expect(prompt).toContain("Round 3 Pro");
		expect(prompt).toContain("Round 3 Con");
	});

	it("includes topic", () => {
		const prompt = buildJudgePrompt(makeState());
		expect(prompt).toContain("[TOPIC]");
		expect(prompt).toContain("Should AI be open-sourced?");
	});
});

describe("buildTurnPrompt backward compat", () => {
	it("still accepts (state, role, options) signature", () => {
		const prompt = buildTurnPrompt(makeState(), "proposer");
		expect(prompt).toContain("Should AI be open-sourced?");
		expect(prompt).toContain("debate_meta");
	});
});

describe("buildTurnPrompt output instructions", () => {
	it("includes new enrichment fields in output instructions", () => {
		const state = makeState({ currentRound: 1 });
		const prompt = buildTurnPrompt(state, "proposer");
		expect(prompt).toContain("rebuttals");
		expect(prompt).toContain("evidence");
		expect(prompt).toContain("risk_flags");
		expect(prompt).toContain("position_shifts");
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
