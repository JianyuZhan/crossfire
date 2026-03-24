import { describe, expect, it } from "vitest";
import { detectDegradation } from "../../src/director/degradation-detector.js";
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

describe("detectDegradation", () => {
	it("returns empty when fewer than 3 turns per role", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "challenger",
					content: "A",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["HA matters"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		expect(detectDegradation(state)).toEqual([]);
	});

	it("detects key-point-repetition when overlap > 70% for 2+ rounds", () => {
		const state = makeState({
			currentRound: 3,
			turns: [
				{
					roundNumber: 1,
					role: "challenger",
					content: "B1",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: [
							"HA is critical",
							"contracts must bind",
							"procurement inertia weak",
						],
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
						confidence: 0.65,
						keyPoints: [
							"HA is critical",
							"contracts must bind",
							"procurement inertia weak",
						],
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
						confidence: 0.62,
						keyPoints: [
							"HA is critical",
							"contracts must bind",
							"procurement inertia weak",
						],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		const signals = detectDegradation(state);
		expect(signals.length).toBeGreaterThan(0);
		expect(signals[0].type).toBe("key-point-repetition");
		expect(signals[0].role).toBe("challenger");
		expect(signals[0].overlapScore).toBeGreaterThan(0.7);
	});

	it("returns empty when key_points are changing", () => {
		const state = makeState({
			currentRound: 3,
			turns: [
				{
					roundNumber: 1,
					role: "challenger",
					content: "B1",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["point A", "point B"],
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
						keyPoints: ["point C", "point D"],
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
						keyPoints: ["point E", "point F"],
						concessions: [],
						wantsToConclude: false,
					},
				},
			],
		});
		expect(detectDegradation(state)).toEqual([]);
	});
});
