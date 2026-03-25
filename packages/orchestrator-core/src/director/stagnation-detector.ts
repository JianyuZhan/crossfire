import type { DebateState, DebateTurn } from "../types.js";
import type { StagnationSignal } from "./types.js";

export function detectStagnation(
	state: DebateState,
	threshold = 2,
): StagnationSignal[] {
	const signals: StagnationSignal[] = [];
	const rounds = groupByRound(state.turns);
	const roundNumbers = Object.keys(rounds)
		.map(Number)
		.sort((a, b) => a - b);

	if (roundNumbers.length < 2) return signals;

	// Check stance-frozen: both sides maintain same stance for threshold+ consecutive rounds
	const proposerStances = getStanceHistory(state.turns, "proposer");
	const challengerStances = getStanceHistory(state.turns, "challenger");

	const frozenRounds = countTrailingFrozen(proposerStances, challengerStances);
	if (frozenRounds >= threshold) {
		signals.push({
			type: "stance-frozen",
			rounds: frozenRounds,
			details: `Both sides maintained same stances for ${frozenRounds} consecutive rounds`,
		});
	}

	// Check one-sided-conclude: one side wantsToConclude for 2+ rounds while other doesn't
	const proposerConcludes = getTrailingConcludeCount(state.turns, "proposer");
	const challengerConcludes = getTrailingConcludeCount(
		state.turns,
		"challenger",
	);

	if (proposerConcludes >= threshold && challengerConcludes === 0) {
		signals.push({
			type: "one-sided-conclude",
			rounds: proposerConcludes,
			details: `Proposer wants to conclude for ${proposerConcludes} rounds, challenger refuses`,
		});
	}
	if (challengerConcludes >= threshold && proposerConcludes === 0) {
		signals.push({
			type: "one-sided-conclude",
			rounds: challengerConcludes,
			details: `Challenger wants to conclude for ${challengerConcludes} rounds, proposer refuses`,
		});
	}

	return signals;
}

function groupByRound(turns: DebateTurn[]): Record<number, DebateTurn[]> {
	const groups: Record<number, DebateTurn[]> = {};
	for (const t of turns) {
		if (!groups[t.roundNumber]) groups[t.roundNumber] = [];
		groups[t.roundNumber].push(t);
	}
	return groups;
}

function getStanceHistory(
	turns: DebateTurn[],
	role: "proposer" | "challenger",
): string[] {
	// Turns are already in chronological order; deduplicate per round (last write wins)
	const byRound = new Map<number, string>();
	for (const t of turns) {
		if (t.role === role && t.meta?.stance) {
			byRound.set(t.roundNumber, t.meta.stance);
		}
	}
	return [...byRound.values()];
}

function countTrailingFrozen(a: string[], b: string[]): number {
	const minLen = Math.min(a.length, b.length);
	if (minLen < 2) return 0;

	let count = 0;
	const lastA = a[a.length - 1];
	const lastB = b[b.length - 1];

	for (let i = a.length - 1; i >= 0 && i >= a.length - minLen; i--) {
		const j = b.length - (a.length - i);
		if (j < 0) break;
		if (a[i] === lastA && b[j] === lastB) {
			count++;
		} else {
			break;
		}
	}
	return count;
}

function getTrailingConcludeCount(
	turns: DebateTurn[],
	role: "proposer" | "challenger",
): number {
	const roleTurns = turns.filter((t) => t.role === role && t.meta);

	let count = 0;
	for (let i = roleTurns.length - 1; i >= 0; i--) {
		if (roleTurns[i].meta?.wantsToConclude) {
			count++;
		} else {
			break;
		}
	}
	return count;
}
