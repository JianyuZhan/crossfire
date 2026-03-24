import type { DebateState } from "../types.js";
import type {
	DegradationSignal,
	DirectorConfig,
	StagnationSignal,
	TriggerJudgeReason,
} from "./types.js";

export interface JudgeTrigger {
	reason: TriggerJudgeReason;
}

export function shouldTriggerJudge(
	state: DebateState,
	config: DirectorConfig,
	stagnation: StagnationSignal[],
	degradation: DegradationSignal[],
	degradationGuidanceCount: number,
): JudgeTrigger | null {
	const { currentRound } = state;
	const { maxRounds } = state.config;

	if (currentRound < config.minJudgeRound) return null;

	// Priority: stagnation > degradation (with prior guidance) > scheduled

	// Stagnation always triggers
	if (stagnation.length > 0) {
		return { reason: "stagnation" };
	}

	// Degradation triggers only if director already issued guidance
	if (degradation.length > 0 && degradationGuidanceCount > 0) {
		return { reason: "degradation" };
	}

	// Mandatory: penultimate round
	if (currentRound === maxRounds - 1) {
		return { reason: "scheduled" };
	}

	// Adaptive scheduled: first at ~30%, then every ~25%
	const firstTrigger = Math.max(
		config.minJudgeRound,
		Math.ceil(maxRounds * 0.3),
	);
	const interval = Math.max(1, Math.ceil(maxRounds * 0.25));

	if (currentRound === firstTrigger) {
		return { reason: "scheduled" };
	}
	if (
		currentRound > firstTrigger &&
		(currentRound - firstTrigger) % interval === 0
	) {
		return { reason: "scheduled" };
	}

	return null;
}
