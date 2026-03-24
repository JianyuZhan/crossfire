import { describe, expect, it } from "vitest";
import { shouldTriggerJudge } from "../../src/director/judge-policy.js";
import type {
	DegradationSignal,
	DirectorConfig,
	StagnationSignal,
} from "../../src/director/types.js";
import { DEFAULT_DIRECTOR_CONFIG } from "../../src/director/types.js";
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

describe("shouldTriggerJudge", () => {
	it("returns null before minJudgeRound", () => {
		const state = makeState({ currentRound: 1 });
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			[],
			[],
			0,
		);
		expect(result).toBeNull();
	});

	it("triggers scheduled at ~30% of maxRounds", () => {
		const state = makeState({ currentRound: 3 }); // 30% of 10
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			[],
			[],
			0,
		);
		expect(result).toEqual({ reason: "scheduled" });
	});

	it("triggers on stagnation signals", () => {
		const state = makeState({ currentRound: 4 });
		const stagnation: StagnationSignal[] = [
			{ type: "stance-frozen", rounds: 3, details: "test" },
		];
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			stagnation,
			[],
			0,
		);
		expect(result).toEqual({ reason: "stagnation" });
	});

	it("triggers on degradation signals when director guidance already issued", () => {
		const state = makeState({ currentRound: 5 });
		const degradation: DegradationSignal[] = [
			{
				type: "key-point-repetition",
				role: "challenger",
				overlapScore: 0.8,
				rounds: 2,
				details: "test",
			},
		];
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			[],
			degradation,
			1,
		);
		expect(result).toEqual({ reason: "degradation" });
	});

	it("returns null for degradation when no prior guidance issued (director handles it)", () => {
		const state = makeState({ currentRound: 5 });
		const degradation: DegradationSignal[] = [
			{
				type: "key-point-repetition",
				role: "challenger",
				overlapScore: 0.8,
				rounds: 2,
				details: "test",
			},
		];
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			[],
			degradation,
			0,
		);
		expect(result).toBeNull();
	});

	it("triggers mandatory before penultimate round", () => {
		const state = makeState({ currentRound: 9 }); // penultimate of 10
		const result = shouldTriggerJudge(
			state,
			DEFAULT_DIRECTOR_CONFIG,
			[],
			[],
			0,
		);
		expect(result).toEqual({ reason: "scheduled" });
	});
});
