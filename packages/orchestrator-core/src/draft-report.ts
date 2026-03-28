import type {
	ArgumentId,
	EvolvingPlan,
	TrackedArgument,
} from "./evolving-plan.js";

// --- DraftReport types ---

export interface DraftReport {
	consensus: Array<{
		title: string;
		supportingRounds: number[];
		challengesSurvived: string[];
		evidence: string[];
	}>;
	unresolved: Array<{
		title: string;
		proposerArguments: string[];
		challengerArguments: string[];
		relatedRisks: string[];
	}>;
	argumentTrajectories: Array<{
		id: ArgumentId;
		text: string;
		side: "proposer" | "challenger";
		firstRound: number;
		finalStatus: "consensus" | "unresolved" | "conceded";
		rounds: Array<{ round: number; event: string }>;
	}>;
	risks: Array<{ risk: string; severity: string; round: number }>;
	evidence: Array<{ claim: string; source: string; round: number }>;
	judgeNotes: EvolvingPlan["judgeNotes"];
	generationQuality: "full" | "draft-filled" | "legacy-fallback";
	degradedRounds: number[];
	warnings: string[];
}

// --- AuditReport types ---

export interface AuditReport {
	executiveSummary: string;
	consensusItems: Array<{
		title: string;
		detail: string;
		nextSteps: string;
		supportingEvidence: string[];
	}>;
	unresolvedIssues: Array<{
		title: string;
		proposerPosition: string;
		challengerPosition: string;
		risk: string;
		suggestedExploration: string;
	}>;
	argumentEvolution: Array<{
		argument: string;
		trajectory: string;
		finalStatus: string;
	}>;
	riskMatrix: Array<{
		risk: string;
		severity: string;
		likelihood: string;
		mitigation: string;
	}>;
	evidenceRegistry: Array<{
		claim: string;
		source: string;
		usedBy: string;
		contested: boolean;
	}>;
}

// --- Pure functions ---

export function buildDraftReport(plan: EvolvingPlan): DraftReport {
	// Sort arguments deterministically: by firstRound, then side (challenger < proposer), then id
	const sortedArgs = Object.values(plan.arguments).sort((a, b) => {
		if (a.firstRound !== b.firstRound) return a.firstRound - b.firstRound;
		if (a.side !== b.side) return a.side < b.side ? -1 : 1;
		return a.id < b.id ? -1 : 1;
	});

	// Classify arguments
	const consensusItems: DraftReport["consensus"] = [];
	const unresolvedItems: DraftReport["unresolved"] = [];
	const trajectories: DraftReport["argumentTrajectories"] = [];

	// First, gather consensus strings from plan.consensus
	for (const c of plan.consensus) {
		consensusItems.push({
			title: c,
			supportingRounds: [],
			challengesSurvived: [],
			evidence: [],
		});
	}

	// Process arguments into trajectories
	for (const arg of sortedArgs) {
		const rounds: Array<{ round: number; event: string }> = [
			{ round: arg.firstRound, event: `Introduced by ${arg.side}` },
		];
		for (const ch of arg.challenges) {
			rounds.push({
				round: ch.round,
				event: `Challenged: ${ch.by} → ${ch.outcome}`,
			});
		}

		let finalStatus: "consensus" | "unresolved" | "conceded";
		if (arg.status === "conceded") {
			finalStatus = "conceded";
		} else if (arg.status === "weakened" || arg.status === "active") {
			finalStatus = "unresolved";
		} else {
			finalStatus = "consensus";
		}

		trajectories.push({
			id: arg.id,
			text: arg.text,
			side: arg.side,
			firstRound: arg.firstRound,
			finalStatus,
			rounds,
		});
	}

	// Build unresolved from plan.unresolved strings + unresolved arguments
	for (const u of plan.unresolved) {
		const proposerArgs = sortedArgs
			.filter(
				(a) =>
					a.side === "proposer" &&
					a.text.toLowerCase().includes(u.toLowerCase().slice(0, 15)),
			)
			.map((a) => a.text);
		const challengerArgs = sortedArgs
			.filter(
				(a) =>
					a.side === "challenger" &&
					a.text.toLowerCase().includes(u.toLowerCase().slice(0, 15)),
			)
			.map((a) => a.text);
		const relatedRisks = plan.risks
			.filter((r) =>
				r.risk.toLowerCase().includes(u.toLowerCase().slice(0, 10)),
			)
			.map((r) => r.risk);
		unresolvedItems.push({
			title: u,
			proposerArguments: proposerArgs,
			challengerArguments: challengerArgs,
			relatedRisks,
		});
	}

	return {
		consensus: consensusItems,
		unresolved: unresolvedItems,
		argumentTrajectories: trajectories,
		risks: plan.risks,
		evidence: plan.evidence,
		judgeNotes: plan.judgeNotes,
		generationQuality:
			plan.degradedRounds.length === 0 ? "full" : "draft-filled",
		degradedRounds: plan.degradedRounds,
		warnings: [],
	};
}

/** Subset of DebateSummary fields used by draftToAuditReport */
export interface FallbackSummaryInput {
	leading?: string;
	judgeScore?: { proposer: number; challenger: number } | null;
	recommendedAction?: string | null;
	consensus?: string[];
	unresolved?: string[];
}

export function draftToAuditReport(
	draft: DraftReport,
	summary?: FallbackSummaryInput,
): AuditReport {
	const totalRounds = Math.max(
		...draft.argumentTrajectories.map((t) => t.firstRound),
		...draft.risks.map((r) => r.round),
		1,
	);

	// --- Merge consensus: draft items + summary items not already in draft ---
	const draftConsensusTitles = new Set(
		draft.consensus.map((c) => c.title.toLowerCase()),
	);
	const mergedConsensus = [...draft.consensus];
	for (const sc of summary?.consensus ?? []) {
		if (!draftConsensusTitles.has(sc.toLowerCase())) {
			mergedConsensus.push({
				title: sc,
				supportingRounds: [],
				challengesSurvived: [],
				evidence: [],
			});
		}
	}

	// --- Merge unresolved: draft items + summary items not already in draft ---
	const draftUnresolvedTitles = new Set(
		draft.unresolved.map((u) => u.title.toLowerCase()),
	);
	const mergedUnresolved = [...draft.unresolved];
	for (const su of summary?.unresolved ?? []) {
		if (!draftUnresolvedTitles.has(su.toLowerCase())) {
			mergedUnresolved.push({
				title: su,
				proposerArguments: [],
				challengerArguments: [],
				relatedRisks: [],
			});
		}
	}

	// --- Executive summary: use summary data when available, fall back to judge notes ---
	const parts: string[] = [`Debate covered ${totalRounds} round(s).`];

	if (mergedConsensus.length > 0) {
		parts.push(`${mergedConsensus.length} item(s) reached consensus.`);
	}
	if (mergedUnresolved.length > 0) {
		parts.push(`${mergedUnresolved.length} issue(s) remain unresolved.`);
	}
	if (summary?.leading && summary.leading !== "unknown") {
		const scoreStr = summary.judgeScore
			? ` (${summary.judgeScore.proposer} vs ${summary.judgeScore.challenger})`
			: "";
		parts.push(`Leading: ${summary.leading}${scoreStr}.`);
	}
	if (summary?.recommendedAction) {
		parts.push(`Recommendation: ${summary.recommendedAction}`);
	} else {
		// Fall back to last judge note reasoning
		const lastJudgeNote =
			draft.judgeNotes.length > 0
				? draft.judgeNotes[draft.judgeNotes.length - 1]
				: undefined;
		if (lastJudgeNote?.reasoning) {
			parts.push(`Judge assessment: ${lastJudgeNote.reasoning}`);
		}
	}
	const executiveSummary = parts.join(" ");

	// --- Consensus items ---
	const consensusItems = mergedConsensus.map((c) => ({
		title: c.title,
		detail: formatConsensusDetail(c),
		nextSteps: extractActionStep(c.title),
		supportingEvidence: c.evidence,
	}));

	// --- Unresolved issues ---
	const unresolvedIssues = mergedUnresolved.map((u) => {
		const proposerPos =
			u.proposerArguments.join("; ") || "No specific position recorded.";
		const challengerPos =
			u.challengerArguments.join("; ") || "No specific position recorded.";
		const risk = u.relatedRisks.join("; ") || "No specific risk identified.";
		const exploration =
			proposerPos !== "No specific position recorded." &&
			challengerPos !== "No specific position recorded."
				? `Compare: proposer argues ${proposerPos.slice(0, 80)}; challenger argues ${challengerPos.slice(0, 80)}. Prototype both approaches to resolve.`
				: `Review ${u.title} with additional stakeholder input.`;
		return {
			title: u.title,
			proposerPosition: proposerPos,
			challengerPosition: challengerPos,
			risk,
			suggestedExploration: exploration,
		};
	});

	// --- Argument evolution ---
	const argumentEvolution = draft.argumentTrajectories.map((t) => ({
		argument: t.text,
		trajectory: t.rounds.map((r) => `R${r.round}: ${r.event}`).join(" → "),
		finalStatus: t.finalStatus,
	}));

	// --- Risk matrix ---
	const riskMatrix = draft.risks.map((r) => {
		const relatedArgs = draft.argumentTrajectories.filter(
			(t) =>
				t.text.toLowerCase().includes(r.risk.toLowerCase().slice(0, 15)) ||
				r.risk.toLowerCase().includes(t.text.toLowerCase().slice(0, 15)),
		);
		const mitigation =
			relatedArgs.length > 0
				? `Related debate points: ${relatedArgs.map((a) => a.text.slice(0, 60)).join("; ")}`
				: `Raised in round ${r.round}; severity: ${r.severity}. Address during implementation planning.`;
		return {
			risk: r.risk,
			severity: r.severity,
			likelihood: severityToLikelihood(r.severity),
			mitigation,
		};
	});

	// --- Evidence registry ---
	const evidenceRegistry = draft.evidence.map((e) => ({
		claim: e.claim,
		source: e.source,
		usedBy: `round ${e.round}`,
		contested: false,
	}));

	return {
		executiveSummary,
		consensusItems,
		unresolvedIssues,
		argumentEvolution,
		riskMatrix,
		evidenceRegistry,
	};
}

function formatConsensusDetail(c: DraftReport["consensus"][number]): string {
	if (c.challengesSurvived.length > 0) {
		return `Survived ${c.challengesSurvived.length} challenge(s): ${c.challengesSurvived.join("; ")}`;
	}
	if (c.supportingRounds.length > 0) {
		return `Discussed in round(s) ${c.supportingRounds.join(", ")}.`;
	}
	return "Agreed upon without significant challenge.";
}

function severityToLikelihood(severity: string): string {
	if (severity === "high") return "high";
	if (severity === "low") return "low";
	return "medium";
}

/** Extract a brief action step from argument text, or return an honest label. */
function extractActionStep(text: string): string {
	const verbMatch = text.match(
		/^(implement|add|create|build|define|remove|migrate|update|refactor|test|deploy|configure|integrate|optimize)/i,
	);
	if (verbMatch) {
		return text.length > 80 ? `${text.slice(0, 77)}...` : text;
	}
	return "See consensus detail above.";
}
