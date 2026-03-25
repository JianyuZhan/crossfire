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

export function draftToAuditReport(draft: DraftReport): AuditReport {
	const totalRounds = Math.max(
		...draft.argumentTrajectories.map((t) => t.firstRound),
		...draft.risks.map((r) => r.round),
		1,
	);

	const executiveSummary = `Debate covered ${totalRounds} round(s). ${draft.consensus.length} item(s) reached consensus, ${draft.unresolved.length} remain unresolved.`;

	const consensusItems = draft.consensus.map((c) => ({
		title: c.title,
		detail:
			c.challengesSurvived.length > 0
				? `Survived ${c.challengesSurvived.length} challenge(s): ${c.challengesSurvived.join("; ")}`
				: "Agreed upon without significant challenge.",
		nextSteps: "Define concrete implementation steps.",
		supportingEvidence: c.evidence,
	}));

	const unresolvedIssues = draft.unresolved.map((u) => ({
		title: u.title,
		proposerPosition:
			u.proposerArguments.join("; ") || "No specific position recorded.",
		challengerPosition:
			u.challengerArguments.join("; ") || "No specific position recorded.",
		risk: u.relatedRisks.join("; ") || "No specific risk identified.",
		suggestedExploration: "Further investigation recommended.",
	}));

	const argumentEvolution = draft.argumentTrajectories.map((t) => ({
		argument: t.text,
		trajectory: t.rounds.map((r) => `R${r.round}: ${r.event}`).join(" → "),
		finalStatus: t.finalStatus,
	}));

	const riskMatrix = draft.risks.map((r) => ({
		risk: r.risk,
		severity: r.severity,
		likelihood: "medium",
		mitigation: "Requires further analysis.",
	}));

	const evidenceRegistry = draft.evidence.map((e) => ({
		claim: e.claim,
		source: e.source,
		usedBy: "debate participant",
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
