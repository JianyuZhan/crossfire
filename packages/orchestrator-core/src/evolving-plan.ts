import type { DebateMeta, JudgeVerdict } from "./types.js";

// --- Types ---

/** Stable argument key: r{round}-{side}-{index} */
export type ArgumentId = string;

export interface TrackedArgument {
	id: ArgumentId;
	text: string;
	side: "proposer" | "challenger";
	firstRound: number;
	status: "active" | "weakened" | "conceded" | "reinforced";
	challenges: Array<{ round: number; by: string; outcome: string }>;
	relatedIds: ArgumentId[];
}

export interface EvolvingPlan {
	arguments: Record<ArgumentId, TrackedArgument>;
	consensus: string[];
	unresolved: string[];
	risks: Array<{ risk: string; severity: string; round: number }>;
	evidence: Array<{ claim: string; source: string; round: number }>;
	judgeNotes: Array<{
		roundNumber: number;
		leading: "proposer" | "challenger" | "tie";
		reasoning: string;
		score?: { proposer: number; challenger: number };
	}>;
	roundSummaries: string[];
	degradedRounds: number[];
	roundAnalyses?: RoundAnalysis[];
	roundSignals: RoundSignals[];
}

export interface RoundAnalysis {
	roundNumber: number;
	newArguments: Array<{
		side: "proposer" | "challenger";
		argument: string;
		strength: "strong" | "moderate" | "weak";
	}>;
	challengedArguments: Array<{
		argument: string;
		challengedBy: string;
		outcome: "held" | "weakened" | "conceded";
	}>;
	risksIdentified: Array<{
		risk: string;
		severity: "low" | "medium" | "high";
		raisedBy: string;
	}>;
	evidenceCited: Array<{
		claim: string;
		source: string;
		side: string;
	}>;
	newConsensus: string[];
	newDivergence: string[];
	roundSummary: string;
}

export interface RoundSignals {
	roundNumber: number;
	/** Count of newly introduced claims (historical dedup preferred) */
	newClaimCount: number;
	/** Round contains explicit concessions from either side (NOT consensus) */
	hasConcession: boolean;
	/** consensus[] content changed after this round vs before (shallow set diff) */
	consensusDelta: boolean;
	/** risks[] content changed after this round vs before (shallow set diff on risk/severity) */
	riskDelta: boolean;
	/** Judge verdict relationship to this round */
	judgeImpact: {
		hasVerdict: boolean;
		weighted: boolean;
		directionChange: boolean;
	};
}

// --- Factory ---

export function emptyPlan(): EvolvingPlan {
	return {
		arguments: {},
		consensus: [],
		unresolved: [],
		risks: [],
		evidence: [],
		judgeNotes: [],
		roundSummaries: [],
		degradedRounds: [],
		roundAnalyses: [],
		roundSignals: [],
	};
}

// --- Pure update functions ---

export function updatePlan(
	plan: EvolvingPlan,
	analysis: RoundAnalysis,
): EvolvingPlan {
	const args = { ...plan.arguments };

	// Add new arguments — track separate index per side
	const sideCounters: Record<string, number> = { proposer: 0, challenger: 0 };
	for (const a of analysis.newArguments) {
		const idx = sideCounters[a.side] ?? 0;
		const id: ArgumentId = `r${analysis.roundNumber}-${a.side}-${idx}`;
		args[id] = {
			id,
			text: a.argument,
			side: a.side,
			firstRound: analysis.roundNumber,
			status: "active",
			challenges: [],
			relatedIds: [],
		};
		sideCounters[a.side] = idx + 1;
	}

	// Process challenges — find matching arguments by substring overlap
	for (const c of analysis.challengedArguments) {
		const matchId = findBestMatch(args, c.argument);
		if (matchId) {
			const existing = args[matchId];
			args[matchId] = {
				...existing,
				status: c.outcome === "held" ? existing.status : c.outcome,
				challenges: [
					...existing.challenges,
					{
						round: analysis.roundNumber,
						by: c.challengedBy,
						outcome: c.outcome,
					},
				],
			};
		}
	}

	// Accumulate risks, evidence, consensus, unresolved
	const risks = [
		...plan.risks,
		...analysis.risksIdentified.map((r) => ({
			risk: r.risk,
			severity: r.severity,
			round: analysis.roundNumber,
		})),
	];

	const evidence = [
		...plan.evidence,
		...analysis.evidenceCited.map((e) => ({
			claim: e.claim,
			source: e.source,
			round: analysis.roundNumber,
		})),
	];

	const consensus = dedup([...plan.consensus, ...analysis.newConsensus]);
	const unresolved = dedup([...plan.unresolved, ...analysis.newDivergence]);

	// Update round summaries — replace if same round already exists
	const summaries = [...plan.roundSummaries];
	const existingIdx = summaries.findIndex(
		(_, i) => i === analysis.roundNumber - 1,
	);
	if (existingIdx >= 0) {
		summaries[existingIdx] = analysis.roundSummary;
	} else {
		// Pad with empty strings if needed, then set
		while (summaries.length < analysis.roundNumber - 1) summaries.push("");
		summaries.push(analysis.roundSummary);
	}

	return {
		...plan,
		arguments: args,
		consensus,
		unresolved,
		risks,
		evidence,
		roundSummaries: summaries,
	};
}

export function updatePlanWithJudge(
	plan: EvolvingPlan,
	verdict: JudgeVerdict,
	roundNumber: number,
): EvolvingPlan {
	return {
		...plan,
		judgeNotes: [
			...plan.judgeNotes,
			{
				roundNumber,
				leading: verdict.leading,
				reasoning: verdict.reasoning,
				...(verdict.score ? { score: verdict.score } : {}),
			},
		],
	};
}

/** Replay analyses in roundNumber order to produce a deterministic EvolvingPlan. */
export function replayPlan(
	analyses: RoundAnalysis[],
	judgeNotes?: EvolvingPlan["judgeNotes"],
): EvolvingPlan {
	const sorted = [...analyses].sort((a, b) => a.roundNumber - b.roundNumber);
	let plan = emptyPlan();
	for (const a of sorted) {
		plan = updatePlan(plan, a);
	}
	if (judgeNotes) {
		const sortedNotes = [...judgeNotes].sort(
			(a, b) => a.roundNumber - b.roundNumber,
		);
		plan = { ...plan, judgeNotes: sortedNotes };
	}
	return plan;
}

/** Build a degraded RoundAnalysis from debate_meta fallback data. */
export function buildFallbackRoundAnalysis(
	roundNumber: number,
	proposerMeta: DebateMeta | undefined,
	challengerMeta: DebateMeta | undefined,
): RoundAnalysis {
	const newArguments: RoundAnalysis["newArguments"] = [];
	const risksIdentified: RoundAnalysis["risksIdentified"] = [];
	const evidenceCited: RoundAnalysis["evidenceCited"] = [];

	if (proposerMeta) {
		for (const kp of proposerMeta.keyPoints) {
			newArguments.push({
				side: "proposer",
				argument: kp,
				strength: "moderate",
			});
		}
		for (const r of proposerMeta.riskFlags ?? []) {
			risksIdentified.push({ ...r, raisedBy: "proposer" });
		}
		for (const e of proposerMeta.evidence ?? []) {
			evidenceCited.push({ ...e, side: "proposer" });
		}
	}

	if (challengerMeta) {
		for (const kp of challengerMeta.keyPoints) {
			newArguments.push({
				side: "challenger",
				argument: kp,
				strength: "moderate",
			});
		}
		for (const r of challengerMeta.riskFlags ?? []) {
			risksIdentified.push({ ...r, raisedBy: "challenger" });
		}
		for (const e of challengerMeta.evidence ?? []) {
			evidenceCited.push({ ...e, side: "challenger" });
		}
	}

	// Consensus: only mutual concessions (both sides concede overlapping points)
	const proposerConcessions = proposerMeta?.concessions ?? [];
	const challengerConcessions = challengerMeta?.concessions ?? [];
	const newConsensus: string[] = [];

	const normalize = (s: string) => s.toLowerCase().trim().slice(0, 20);
	const challengerNorms = challengerConcessions.map(normalize);
	const proposerNorms = proposerConcessions.map(normalize);

	for (const pc of proposerConcessions) {
		if (challengerNorms.some((cn) => cn === normalize(pc))) {
			newConsensus.push(pc);
		}
	}
	for (const cc of challengerConcessions) {
		if (
			proposerNorms.some((pn) => pn === normalize(cc)) &&
			!newConsensus.some((c) => normalize(c) === normalize(cc))
		) {
			newConsensus.push(cc);
		}
	}

	// Divergence: when both sides have disagree/strongly_disagree stance
	const disagreeStances = new Set(["disagree", "strongly_disagree"]);
	const newDivergence: string[] = [];
	if (
		proposerMeta &&
		challengerMeta &&
		disagreeStances.has(proposerMeta.stance) &&
		disagreeStances.has(challengerMeta.stance)
	) {
		const consensusNorms = new Set(newConsensus.map(normalize));
		for (const kp of proposerMeta.keyPoints) {
			if (!consensusNorms.has(normalize(kp))) {
				newDivergence.push(kp);
			}
		}
		for (const kp of challengerMeta.keyPoints) {
			if (
				!consensusNorms.has(normalize(kp)) &&
				!newDivergence.some((d) => normalize(d) === normalize(kp))
			) {
				newDivergence.push(kp);
			}
		}
	}

	const stances: string[] = [];
	if (proposerMeta)
		stances.push(
			`proposer: ${proposerMeta.stance} (${proposerMeta.confidence})`,
		);
	if (challengerMeta)
		stances.push(
			`challenger: ${challengerMeta.stance} (${challengerMeta.confidence})`,
		);
	const roundSummary = `Round ${roundNumber}: ${stances.join(", ") || "no meta available"}`;

	return {
		roundNumber,
		newArguments,
		challengedArguments: (proposerMeta?.rebuttals ?? []).map((r) => ({
			argument: r.target,
			challengedBy: r.response,
			outcome: "weakened" as const,
		})),
		risksIdentified,
		evidenceCited,
		newConsensus: dedup(newConsensus),
		newDivergence: dedup(newDivergence),
		roundSummary,
	};
}

// --- Helpers ---

function dedup(arr: string[]): string[] {
	return [...new Set(arr)];
}

/** Find the best matching argument by substring overlap (first 30 chars). */
function findBestMatch(
	args: Record<ArgumentId, TrackedArgument>,
	text: string,
): ArgumentId | undefined {
	const prefix = text.toLowerCase().slice(0, 30);
	for (const [id, arg] of Object.entries(args)) {
		if (
			arg.text.toLowerCase().includes(prefix) ||
			prefix.includes(arg.text.toLowerCase().slice(0, 30))
		) {
			return id;
		}
	}
	return undefined;
}
