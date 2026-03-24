// packages/orchestrator-core/__tests__/context-builder.test.ts
import { describe, expect, it } from "vitest";
import {
	buildJudgePrompt,
	buildJudgePromptContext,
	buildPromptContext,
	buildTurnPrompt,
	buildTurnPromptFromState,
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
		expect(prompt).toContain("[LONG-TERM DEBATE MEMORY]");
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
		expect(prompt).toContain("weaknesses");
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
		expect(prompt).toContain("[DEBATE SUMMARY]");
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
