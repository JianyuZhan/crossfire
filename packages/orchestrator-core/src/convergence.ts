// packages/orchestrator-core/src/convergence.ts
import type { ConvergenceResult, DebateMeta, DebateState } from "./types.js";

const STANCE_VALUES: Record<string, number> = {
	strongly_agree: 1.0,
	agree: 0.75,
	neutral: 0.5,
	disagree: 0.25,
	strongly_disagree: 0.0,
};

export function checkConvergence(state: DebateState): ConvergenceResult {
	const latestProposer = findLatestMeta(state, "proposer");
	const latestChallenger = findLatestMeta(state, "challenger");

	const stanceDelta = computeStanceDelta(latestProposer, latestChallenger);
	const mutualConcessions = countMutualConcessions(
		latestProposer,
		latestChallenger,
	);
	const bothWantToConclude =
		(latestProposer?.wantsToConclude ?? false) &&
		(latestChallenger?.wantsToConclude ?? false);

	const converged =
		bothWantToConclude || stanceDelta <= state.config.convergenceThreshold;

	// Detect single-party strong convergence (for Director use)
	const singlePartyStrongConvergence =
		detectSinglePartyStrongConvergence(state);

	return {
		converged,
		stanceDelta,
		mutualConcessions,
		bothWantToConclude,
		singlePartyStrongConvergence,
	};
}

function findLatestMeta(
	state: DebateState,
	role: "proposer" | "challenger",
): DebateMeta | undefined {
	for (let i = state.turns.length - 1; i >= 0; i--) {
		if (state.turns[i].role === role && state.turns[i].meta) {
			return state.turns[i].meta;
		}
	}
	return undefined;
}

function computeStanceDelta(
	a: DebateMeta | undefined,
	b: DebateMeta | undefined,
): number {
	if (!a || !b) return 1.0;
	const va = STANCE_VALUES[a.stance] ?? 0.5;
	const vb = STANCE_VALUES[b.stance] ?? 0.5;
	return Math.abs(va - vb);
}

function countMutualConcessions(
	a: DebateMeta | undefined,
	b: DebateMeta | undefined,
): number {
	if (!a?.concessions || !b?.concessions) return 0;
	const aSet = new Set(a.concessions.map((c) => c.toLowerCase()));
	const bSet = new Set(b.concessions.map((c) => c.toLowerCase()));
	let count = 0;
	for (const c of aSet) {
		if (bSet.has(c)) count++;
	}
	return count;
}

function detectSinglePartyStrongConvergence(
	state: DebateState,
): { role: "proposer" | "challenger"; rounds: number } | undefined {
	const MIN_ROUNDS = 2;
	const MIN_CONFIDENCE = 0.9;

	// Check proposer
	const proposerStreak = countStrongConvergenceStreak(
		state,
		"proposer",
		MIN_CONFIDENCE,
	);
	if (proposerStreak >= MIN_ROUNDS) {
		return { role: "proposer", rounds: proposerStreak };
	}

	// Check challenger
	const challengerStreak = countStrongConvergenceStreak(
		state,
		"challenger",
		MIN_CONFIDENCE,
	);
	if (challengerStreak >= MIN_ROUNDS) {
		return { role: "challenger", rounds: challengerStreak };
	}

	return undefined;
}

function countStrongConvergenceStreak(
	state: DebateState,
	role: "proposer" | "challenger",
	minConfidence: number,
): number {
	let streak = 0;
	// Walk backwards through turns
	for (let i = state.turns.length - 1; i >= 0; i--) {
		const turn = state.turns[i];
		if (turn.role !== role) continue;

		const meta = turn.meta;
		if (meta?.wantsToConclude && (meta.confidence ?? 0) >= minConfidence) {
			streak++;
		} else {
			// Streak broken
			break;
		}
	}
	return streak;
}
