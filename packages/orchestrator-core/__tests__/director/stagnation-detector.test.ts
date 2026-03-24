import { describe, expect, it } from "vitest";
import { detectStagnation } from "../../src/director/stagnation-detector.js";
import type { DebateConfig, DebateState } from "../../src/types.js";

const config: DebateConfig = {
	topic: "Test",
	maxRounds: 10,
	judgeEveryNRounds: 3,
	convergenceThreshold: 0.3,
};

function makeState(overrides: Partial<DebateState> = {}): DebateState {
	return {
		config,
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

describe("detectStagnation", () => {
	it("returns empty signals when fewer than 2 rounds", () => {
		const state = makeState({
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
		expect(detectStagnation(state)).toEqual([]);
	});

	it("detects stance-frozen when both sides have same stance for 2+ rounds", () => {
		const state = makeState({
			currentRound: 3,
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
				{
					roundNumber: 2,
					role: "proposer",
					content: "A2",
					meta: {
						stance: "agree",
						confidence: 0.85,
						keyPoints: ["p2"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "B2",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["c2"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 3,
					role: "proposer",
					content: "A3",
					meta: {
						stance: "agree",
						confidence: 0.9,
						keyPoints: ["p3"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 3,
					role: "challenger",
					content: "B3",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["c3"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		const signals = detectStagnation(state);
		expect(signals.some((s) => s.type === "stance-frozen")).toBe(true);
	});

	it("detects one-sided-conclude when one side wants to conclude for 2+ rounds", () => {
		const state = makeState({
			currentRound: 3,
			turns: [
				{
					roundNumber: 2,
					role: "proposer",
					content: "A",
					meta: {
						stance: "agree",
						confidence: 0.9,
						keyPoints: ["p1"],
						concessions: [],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "B",
					meta: {
						stance: "disagree",
						confidence: 0.6,
						keyPoints: ["c1"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 3,
					role: "proposer",
					content: "A2",
					meta: {
						stance: "agree",
						confidence: 0.93,
						keyPoints: ["p2"],
						concessions: [],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 3,
					role: "challenger",
					content: "B2",
					meta: {
						stance: "disagree",
						confidence: 0.6,
						keyPoints: ["c2"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		const signals = detectStagnation(state);
		expect(signals.some((s) => s.type === "one-sided-conclude")).toBe(true);
	});

	it("returns empty when stances are changing", () => {
		const state = makeState({
			currentRound: 2,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "A",
					meta: {
						stance: "strongly_agree",
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
				{
					roundNumber: 2,
					role: "proposer",
					content: "A2",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["p2"],
						concessions: [],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "B2",
					meta: {
						stance: "neutral",
						confidence: 0.6,
						keyPoints: ["c2"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		expect(detectStagnation(state)).toEqual([]);
	});
});
