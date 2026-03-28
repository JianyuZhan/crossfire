import { filterUnresolved } from "../debate-memory.js";
import type { DebateState, DebateTurn, JudgeVerdict } from "../types.js";

export interface DebateSummary {
	terminationReason: string;
	roundsCompleted: number;
	leading: string;
	judgeScore: { proposer: number; challenger: number } | null;
	recommendedAction: string | null;
	stanceTrajectory: {
		proposer: Array<{ round: number; stance: string; confidence: number }>;
		challenger: Array<{ round: number; stance: string; confidence: number }>;
	};
	consensus: string[];
	unresolved: string[];
	totalTurns: number;
}

export function generateSummary(
	state: DebateState,
	verdict: JudgeVerdict | undefined,
	terminationReasonOverride?: string,
): DebateSummary {
	const proposerTrajectory = buildTrajectory(state.turns, "proposer");
	const challengerTrajectory = buildTrajectory(state.turns, "challenger");

	const proposerConcessions = collectConcessions(state.turns, "proposer");
	const challengerConcessions = collectConcessions(state.turns, "challenger");

	const latestRound = state.currentRound;
	const latestProposerPoints = state.turns
		.filter(
			(t) =>
				t.role === "proposer" &&
				t.roundNumber === latestRound &&
				t.meta?.keyPoints,
		)
		.flatMap((t) => t.meta?.keyPoints ?? []);
	const latestChallengerPoints = state.turns
		.filter(
			(t) =>
				t.role === "challenger" &&
				t.roundNumber === latestRound &&
				t.meta?.keyPoints,
		)
		.flatMap((t) => t.meta?.keyPoints ?? []);

	// Infer leading from stance trajectory when no verdict available
	let leading = verdict?.leading ?? "unknown";
	if (
		leading === "unknown" &&
		proposerTrajectory.length > 0 &&
		challengerTrajectory.length > 0
	) {
		const lastP = proposerTrajectory[proposerTrajectory.length - 1];
		const lastC = challengerTrajectory[challengerTrajectory.length - 1];
		if (lastP.confidence > lastC.confidence + 0.1) leading = "proposer";
		else if (lastC.confidence > lastP.confidence + 0.1) leading = "challenger";
		else leading = "tie";
	}

	return {
		terminationReason:
			terminationReasonOverride ?? state.terminationReason ?? "unknown",
		roundsCompleted: state.currentRound,
		leading,
		judgeScore: verdict?.score ?? null,
		recommendedAction: verdict?.reasoning ?? null,
		stanceTrajectory: {
			proposer: proposerTrajectory,
			challenger: challengerTrajectory,
		},
		consensus: computeConsensus(proposerConcessions, challengerConcessions),
		unresolved: computeUnresolved(
			latestProposerPoints,
			latestChallengerPoints,
			proposerConcessions,
			challengerConcessions,
		),
		totalTurns: state.turns.length,
	};
}

export function formatFinalOutcome(
	state: DebateState,
	verdict: JudgeVerdict | undefined,
): string {
	const summary = generateSummary(state, verdict);
	const lines: string[] = [];
	lines.push("## Final Outcome");
	lines.push("");
	lines.push(
		`**Termination**: ${summary.terminationReason} (Round ${summary.roundsCompleted})`,
	);

	if (summary.judgeScore) {
		lines.push(
			`**Leading**: ${summary.leading} (Judge score: ${summary.judgeScore.proposer} vs ${summary.judgeScore.challenger})`,
		);
	} else {
		lines.push(`**Leading**: ${summary.leading}`);
	}

	if (summary.consensus.length > 0) {
		lines.push(`**Consensus** (${summary.consensus.length} items):`);
		for (const c of summary.consensus) lines.push(`  - ${c}`);
	}
	if (summary.unresolved.length > 0) {
		lines.push(`**Unresolved** (${summary.unresolved.length} items):`);
		for (const u of summary.unresolved) lines.push(`  - ${u}`);
	}

	lines.push("**Stance Trajectory**:");
	lines.push(
		`  Proposer: ${summary.stanceTrajectory.proposer.map((s) => s.stance).join(" -> ")} (confidence: ${summary.stanceTrajectory.proposer.map((s) => s.confidence).join(" -> ")})`,
	);
	lines.push(
		`  Challenger: ${summary.stanceTrajectory.challenger.map((s) => s.stance).join(" -> ")} (confidence: ${summary.stanceTrajectory.challenger.map((s) => s.confidence).join(" -> ")})`,
	);

	if (summary.recommendedAction)
		lines.push(`**Recommended Action**: ${summary.recommendedAction}`);
	lines.push(`**Cost**: ${summary.totalTurns} turns`);
	if (summary.consensus.length > 0 || summary.unresolved.length > 0) {
		lines.push("");
		lines.push("*Detailed action plan saved to `action-plan.html`*");
	}
	return lines.join("\n");
}

/** Collects all concession strings for a given role. */
function collectConcessions(
	turns: DebateTurn[],
	role: "proposer" | "challenger",
): Set<string> {
	return new Set(
		turns
			.filter((t) => t.role === role && t.meta?.concessions)
			.flatMap((t) => t.meta?.concessions ?? []),
	);
}

/** Items both sides conceded — union of all concession strings. */
function computeConsensus(
	proposerConcessions: Set<string>,
	challengerConcessions: Set<string>,
): string[] {
	return [...new Set([...proposerConcessions, ...challengerConcessions])];
}

/** Key points NOT acknowledged by the other side's concessions */
function computeUnresolved(
	proposerPoints: string[],
	challengerPoints: string[],
	proposerConcessions: Set<string>,
	challengerConcessions: Set<string>,
): string[] {
	const allConcessions = [...proposerConcessions, ...challengerConcessions];

	return filterUnresolved(
		[...proposerPoints, ...challengerPoints],
		allConcessions,
	);
}

function buildTrajectory(
	turns: DebateTurn[],
	role: "proposer" | "challenger",
): Array<{ round: number; stance: string; confidence: number }> {
	const seen = new Map<number, { stance: string; confidence: number }>();
	for (const t of turns) {
		if (t.role === role && t.meta) {
			seen.set(t.roundNumber, {
				stance: t.meta.stance,
				confidence: t.meta.confidence,
			});
		}
	}
	return [...seen.entries()]
		.sort(([a], [b]) => a - b)
		.map(([round, data]) => ({ round, ...data }));
}
