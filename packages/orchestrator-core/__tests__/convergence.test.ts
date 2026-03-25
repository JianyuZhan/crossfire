// packages/orchestrator-core/__tests__/convergence.test.ts
import { describe, expect, it } from "vitest";
import { checkConvergence } from "../src/convergence.js";
import type { DebateState } from "../src/types.js";

function makeState(overrides: Partial<DebateState> = {}): DebateState {
	return {
		config: {
			topic: "Test topic",
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

describe("checkConvergence", () => {
	it("returns not converged with no turns", () => {
		const state = makeState();
		const result = checkConvergence(state);
		expect(result.converged).toBe(false);
	});

	it("returns not converged when stances are far apart", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "I strongly agree",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["Point A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "I strongly disagree",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.9,
						keyPoints: ["Counter A"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(false);
		expect(result.stanceDelta).toBe(1.0);
	});

	it("detects convergence when stances are close", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 2,
					role: "proposer",
					content: "I agree",
					meta: {
						stance: "agree",
						confidence: 0.7,
						keyPoints: ["Point A"],
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "I also agree somewhat",
					meta: {
						stance: "neutral",
						confidence: 0.6,
						keyPoints: ["Counter A"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(true);
		expect(result.stanceDelta).toBe(0.25);
	});

	it("detects convergence when both want to conclude", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Let's wrap up",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["Final point"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Agreed, done",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.9,
						keyPoints: ["Final counter"],
						wantsToConclude: true,
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(true);
		expect(result.bothWantToConclude).toBe(true);
	});

	it("counts mutual concessions", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Conceding point B",
					meta: {
						stance: "agree",
						confidence: 0.6,
						keyPoints: ["A"],
						concessions: ["B", "C"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Conceding point A",
					meta: {
						stance: "disagree",
						confidence: 0.6,
						keyPoints: ["D"],
						concessions: ["A", "B"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.mutualConcessions).toBe(1); // "B" is mutual
	});

	it("uses only latest turns per role for stance delta", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Old stance",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Old stance",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.9,
						keyPoints: ["B"],
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "New stance",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "New stance",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["B"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.stanceDelta).toBe(0.0);
		expect(result.converged).toBe(true);
	});

	it("handles turns without meta gracefully", () => {
		const state = makeState({
			turns: [
				{ roundNumber: 1, role: "proposer", content: "No meta" },
				{ roundNumber: 1, role: "challenger", content: "No meta either" },
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(false);
		expect(result.stanceDelta).toBe(1.0);
	});

	it("detects single-party strong convergence for proposer", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Round 1",
					meta: {
						stance: "strongly_agree",
						confidence: 0.95,
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Round 1 challenger",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["Counter A"],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "Round 2",
					meta: {
						stance: "strongly_agree",
						confidence: 0.92,
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "Round 2 challenger",
					meta: {
						stance: "disagree",
						confidence: 0.6,
						keyPoints: ["Counter A"],
						wantsToConclude: false,
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(false);
		expect(result.singlePartyStrongConvergence).toEqual({
			role: "proposer",
			rounds: 2,
		});
	});

	it("detects single-party strong convergence for challenger", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Round 1",
					meta: {
						stance: "agree",
						confidence: 0.6,
						keyPoints: ["Point A"],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Round 1 challenger",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.91,
						keyPoints: ["Counter A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "Round 2",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["Point A"],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "challenger",
					content: "Round 2 challenger",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.95,
						keyPoints: ["Counter A"],
						wantsToConclude: true,
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(false);
		expect(result.singlePartyStrongConvergence).toEqual({
			role: "challenger",
			rounds: 2,
		});
	});

	it("does not detect single-party strong convergence with only 1 round", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Round 1",
					meta: {
						stance: "strongly_agree",
						confidence: 0.95,
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Round 1 challenger",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["Counter A"],
						wantsToConclude: false,
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.singlePartyStrongConvergence).toBeUndefined();
	});

	it("does not detect single-party strong convergence with low confidence", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Round 1",
					meta: {
						stance: "strongly_agree",
						confidence: 0.85, // Below 0.9 threshold
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Round 1 challenger",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["Counter A"],
						wantsToConclude: false,
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "Round 2",
					meta: {
						stance: "strongly_agree",
						confidence: 0.88, // Below 0.9 threshold
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.singlePartyStrongConvergence).toBeUndefined();
	});

	it("breaks streak when wantsToConclude becomes false", () => {
		const state = makeState({
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Round 1",
					meta: {
						stance: "strongly_agree",
						confidence: 0.95,
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 2,
					role: "proposer",
					content: "Round 2",
					meta: {
						stance: "agree",
						confidence: 0.92,
						keyPoints: ["Point A"],
						wantsToConclude: false, // Breaks the streak
					},
				},
				{
					roundNumber: 3,
					role: "proposer",
					content: "Round 3",
					meta: {
						stance: "strongly_agree",
						confidence: 0.93,
						keyPoints: ["Point A"],
						wantsToConclude: true,
					},
				},
			],
		});
		const result = checkConvergence(state);
		// Only 1 round streak (most recent)
		expect(result.singlePartyStrongConvergence).toBeUndefined();
	});

	it("threshold=0 requires exact stance match", () => {
		// Both neutral (delta=0) should converge with threshold=0
		const converging = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Neutral stance",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Also neutral",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["B"],
					},
				},
			],
		});
		const resultConverging = checkConvergence(converging);
		expect(resultConverging.converged).toBe(true);
		expect(resultConverging.stanceDelta).toBe(0.0);

		// agree vs neutral (delta=0.25) should NOT converge with threshold=0
		const diverging = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "I agree",
					meta: {
						stance: "agree",
						confidence: 0.7,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Neutral",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["B"],
					},
				},
			],
		});
		const resultDiverging = checkConvergence(diverging);
		expect(resultDiverging.converged).toBe(false);
		expect(resultDiverging.stanceDelta).toBe(0.25);
	});

	it("threshold=1.0 always converges regardless of stances", () => {
		// strongly_agree vs strongly_disagree (delta=1.0) converges since 1.0 <= 1.0
		const state = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 1.0,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Strongly agree",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Strongly disagree",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.9,
						keyPoints: ["B"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(true);
		expect(result.stanceDelta).toBe(1.0);
	});

	it("threshold > 1.0 always converges", () => {
		// Documenting: no upper bound validation on threshold
		const state = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 2.0,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Strongly agree",
					meta: {
						stance: "strongly_agree",
						confidence: 0.9,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Strongly disagree",
					meta: {
						stance: "strongly_disagree",
						confidence: 0.9,
						keyPoints: ["B"],
					},
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.converged).toBe(true);
		expect(result.stanceDelta).toBe(1.0);
	});

	it("negative threshold never converges on stance delta alone", () => {
		// stanceDelta is always >= 0, so it can never be <= -0.5
		// Only bothWantToConclude can trigger convergence
		const stateNoConverge = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: -0.5,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Same stance",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Same stance",
					meta: {
						stance: "neutral",
						confidence: 0.5,
						keyPoints: ["B"],
					},
				},
			],
		});
		const resultNoConverge = checkConvergence(stateNoConverge);
		// Even identical stances (delta=0) don't converge: 0 > -0.5 is true but 0 <= -0.5 is false
		expect(resultNoConverge.converged).toBe(false);
		expect(resultNoConverge.stanceDelta).toBe(0.0);

		// But bothWantToConclude still triggers convergence
		const stateConverge = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: -0.5,
			},
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "Let's wrap up",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["A"],
						wantsToConclude: true,
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "Agreed, done",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["B"],
						wantsToConclude: true,
					},
				},
			],
		});
		const resultConverge = checkConvergence(stateConverge);
		expect(resultConverge.converged).toBe(true);
		expect(resultConverge.bothWantToConclude).toBe(true);
	});

	it("no meta data yields stanceDelta=1.0", () => {
		// When turns have no meta, computeStanceDelta returns 1.0 for undefined inputs
		const state = makeState({
			config: {
				topic: "Test topic",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			turns: [
				{ roundNumber: 1, role: "proposer", content: "No meta here" },
				{
					roundNumber: 1,
					role: "challenger",
					content: "No meta here either",
				},
			],
		});
		const result = checkConvergence(state);
		expect(result.stanceDelta).toBe(1.0);
		expect(result.converged).toBe(false);
	});
});
