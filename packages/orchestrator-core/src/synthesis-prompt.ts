import type {
	EvolvingPlan,
	RoundAnalysis,
	RoundSignals,
} from "./evolving-plan.js";
import { emptyPlan } from "./evolving-plan.js";
import { stripInternalBlocks } from "./strip-internal-blocks.js";
import type { DebateState } from "./types.js";

export interface SynthesisPromptConfig {
	contextTokenLimit: number;
	recentK?: number;
	impactM?: number;
	quoteSnippetBudgetChars?: number;
}

export interface JudgeNote {
	roundNumber: number;
	leading: "proposer" | "challenger" | "tie";
	reasoning: string;
	score?: { proposer: number; challenger: number };
}

/**
 * Applies spec defaults and normalization rules to SynthesisPromptConfig.
 * - recentK: default 3, normalized to max(1, floor(value))
 * - impactM: default 2, normalized to max(0, floor(value))
 * - quoteSnippetBudgetChars: default 2000, normalized to max(0, floor(value))
 */
export function normalizeConfig(
	config: SynthesisPromptConfig,
): Required<SynthesisPromptConfig> {
	const recentK = Math.max(1, Math.floor(config.recentK ?? 3));
	const impactM = Math.max(0, Math.floor(config.impactM ?? 2));
	const quoteSnippetBudgetChars = Math.max(
		0,
		Math.floor(config.quoteSnippetBudgetChars ?? 2000),
	);

	return {
		contextTokenLimit: config.contextTokenLimit,
		recentK,
		impactM,
		quoteSnippetBudgetChars,
	};
}

/** Scored round data with Tier-1 signal breakdown */
export interface ScoredRound {
	roundNumber: number;
	score: number;
	breakdown: {
		recency: number;
		novelty: number;
		concession: number;
		consensusDelta: number;
		riskDelta: number;
		judgeImpact: number;
		reference: number;
	};
}

/** Computes judgeImpact score from RoundSignals.judgeImpact flags. */
function computeJudgeImpactScore(
	judgeImpact: RoundSignals["judgeImpact"],
): number {
	if (judgeImpact.directionChange) return 1.0;
	if (judgeImpact.weighted) return 0.5;
	if (judgeImpact.hasVerdict) return 0.3;
	return 0;
}

/**
 * Scores rounds for synthesis using Tier-1 signals.
 *
 * For each round 1..totalRounds:
 * - If RoundSignals exists and round is NOT degraded: full formula
 * - If RoundSignals exists and round IS degraded: zero novelty/concession/consensusDelta/riskDelta/reference, keep recency + judgeImpact
 * - If RoundSignals is missing: recency only (+ judgeImpact if available)
 *
 * referenceScores is an optional additive input (Phase 3), defaults to 0.
 */
export function scoreRoundsForSynthesis(
	totalRounds: number,
	roundSignals: RoundSignals[],
	degradedRounds: number[],
	referenceScores?: Map<number, number>,
): ScoredRound[] {
	const signalsMap = new Map<number, RoundSignals>();
	for (const s of roundSignals) {
		signalsMap.set(s.roundNumber, s);
	}
	const degradedSet = new Set(degradedRounds);

	const scored: ScoredRound[] = [];

	for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber++) {
		const recency = roundNumber / totalRounds;
		const signals = signalsMap.get(roundNumber);
		const isDegraded = degradedSet.has(roundNumber);

		if (signals && !isDegraded) {
			// Full formula
			const novelty = Math.min(signals.newClaimCount / 3, 1.0);
			const concession = signals.hasConcession ? 1.0 : 0;
			const consensusDelta = signals.consensusDelta ? 0.8 : 0;
			const riskDelta = signals.riskDelta ? 0.6 : 0;
			const judgeImpact = computeJudgeImpactScore(signals.judgeImpact);
			const reference = referenceScores?.get(roundNumber) ?? 0;

			const score =
				recency +
				novelty +
				concession +
				consensusDelta +
				riskDelta +
				judgeImpact +
				reference;

			scored.push({
				roundNumber,
				score,
				breakdown: {
					recency,
					novelty,
					concession,
					consensusDelta,
					riskDelta,
					judgeImpact,
					reference,
				},
			});
		} else if (signals && isDegraded) {
			// Degraded: keep recency + judgeImpact only
			const judgeImpact = computeJudgeImpactScore(signals.judgeImpact);

			scored.push({
				roundNumber,
				score: recency + judgeImpact,
				breakdown: {
					recency,
					novelty: 0,
					concession: 0,
					consensusDelta: 0,
					riskDelta: 0,
					judgeImpact,
					reference: 0,
				},
			});
		} else {
			// Missing signals: recency only
			scored.push({
				roundNumber,
				score: recency,
				breakdown: {
					recency,
					novelty: 0,
					concession: 0,
					consensusDelta: 0,
					riskDelta: 0,
					judgeImpact: 0,
					reference: 0,
				},
			});
		}
	}

	// Return sorted by roundNumber ascending
	scored.sort((a, b) => a.roundNumber - b.roundNumber);
	return scored;
}

/**
 * Selects which rounds get full text vs compressed.
 *
 * 1. Always include the most recent recentK rounds
 * 2. From remaining, promote top impactM by score (tie-break: higher roundNumber)
 * 3. Everything else is compressed
 */
export function selectCriticalRounds(
	scored: ScoredRound[],
	totalRounds: number,
	recentK: number,
	impactM: number,
): { fullText: Set<number>; compressed: Set<number> } {
	const allRounds = scored.map((s) => s.roundNumber);
	const fullText = new Set<number>();

	// 1. Recent K: last recentK round numbers
	const sortedByNumber = [...allRounds].sort((a, b) => a - b);
	const recentStart = Math.max(0, sortedByNumber.length - recentK);
	for (let i = recentStart; i < sortedByNumber.length; i++) {
		fullText.add(sortedByNumber[i]);
	}

	// 2. Top M by score from remaining (tie-break: higher roundNumber)
	const remaining = scored
		.filter((s) => !fullText.has(s.roundNumber))
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.roundNumber - a.roundNumber; // higher roundNumber wins tie
		});

	for (let i = 0; i < Math.min(impactM, remaining.length); i++) {
		fullText.add(remaining[i].roundNumber);
	}

	// 3. Everything else compressed
	const compressed = new Set<number>();
	for (const r of allRounds) {
		if (!fullText.has(r)) {
			compressed.add(r);
		}
	}

	return { fullText, compressed };
}

/**
 * Computes Tier-2 reference centrality scores for each round.
 *
 * Heuristics (spec Section 4.2):
 * 1. Rebuttal back-references: count how many later rounds' rebuttals[].target
 *    match this round's keyPoints (substring match, case-insensitive, first 30 chars)
 * 2. Judge re-mentions: count later judge notes whose reasoning references
 *    this round's key disputes (substring match)
 *
 * Normalizes result to 0..1 range.
 *
 * Data sources: state.turns[].meta for rebuttals/keyPoints, plan.judgeNotes for judge.
 * NOT in PlanAccumulator — computed at synthesis time.
 */
export function computeReferenceScores(
	state: DebateState,
	plan: EvolvingPlan,
): Map<number, number> {
	const rawScores = new Map<number, number>();

	// Collect keyPoints per round (from turns with meta)
	const roundKeyPoints = new Map<number, string[]>();
	for (const turn of state.turns) {
		if (!turn.meta) continue;
		const existing = roundKeyPoints.get(turn.roundNumber) ?? [];
		existing.push(...turn.meta.keyPoints);
		roundKeyPoints.set(turn.roundNumber, existing);
	}

	if (roundKeyPoints.size === 0) return rawScores;

	// Heuristic 1: Rebuttal back-references
	// For each round's rebuttals, check if the target matches any earlier round's keyPoints
	for (const turn of state.turns) {
		if (!turn.meta?.rebuttals) continue;
		for (const rebuttal of turn.meta.rebuttals) {
			const targetNorm = rebuttal.target.toLowerCase().trim().slice(0, 30);
			if (targetNorm.length === 0) continue;

			// Check all earlier rounds' keyPoints
			for (const [earlierRound, keyPoints] of roundKeyPoints) {
				if (earlierRound >= turn.roundNumber) continue;
				for (const kp of keyPoints) {
					const kpNorm = kp.toLowerCase().trim().slice(0, 30);
					if (kpNorm.includes(targetNorm) || targetNorm.includes(kpNorm)) {
						rawScores.set(earlierRound, (rawScores.get(earlierRound) ?? 0) + 1);
						break; // Only count once per rebuttal per round
					}
				}
			}
		}
	}

	// Heuristic 2: Judge re-mentions
	// For each judge note, check if reasoning references earlier rounds' key disputes
	for (const note of plan.judgeNotes) {
		const reasoningLower = note.reasoning.toLowerCase();
		if (reasoningLower.length === 0) continue;

		for (const [roundNum, keyPoints] of roundKeyPoints) {
			if (roundNum >= note.roundNumber) continue;
			for (const kp of keyPoints) {
				const kpNorm = kp.toLowerCase().trim().slice(0, 30);
				if (kpNorm.length > 0 && reasoningLower.includes(kpNorm)) {
					rawScores.set(roundNum, (rawScores.get(roundNum) ?? 0) + 1);
					break; // Only count once per judge note per round
				}
			}
		}
	}

	// Normalize to 0..1
	if (rawScores.size === 0) return rawScores;

	const maxRaw = Math.max(...rawScores.values());
	if (maxRaw === 0) return rawScores;

	const normalized = new Map<number, number>();
	for (const [round, score] of rawScores) {
		normalized.set(round, score / maxRaw);
	}

	return normalized;
}

/**
 * Builds Layer 4 quote snippets from compressed rounds.
 *
 * Selection rules (spec Section 4.3):
 * - Only consider compressed rounds that have transcript data
 * - Rank candidates by score descending
 * - Equal scores: higher roundNumber wins (tie-break)
 * - Render chosen snippets in ascending roundNumber order
 * - Respect char budget heuristically
 * - Deterministic output
 */
export function buildQuoteSnippets(
	cleanTranscript: Map<number, { proposer?: string; challenger?: string }>,
	compressedRounds: number[],
	scored: ScoredRound[],
	budgetChars: number,
): { text: string; sourceRounds: number[] } {
	if (compressedRounds.length === 0 || budgetChars <= 0) {
		return { text: "", sourceRounds: [] };
	}

	const compressedSet = new Set(compressedRounds);

	// Filter scored rounds to only compressed ones with transcript
	const candidates = scored
		.filter(
			(s) =>
				compressedSet.has(s.roundNumber) && cleanTranscript.has(s.roundNumber),
		)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.roundNumber - a.roundNumber; // tie-break: higher round wins
		});

	if (candidates.length === 0) {
		return { text: "", sourceRounds: [] };
	}

	// Select candidates within budget
	const selected: Array<{ roundNumber: number; snippet: string }> = [];
	let usedChars = 0;

	for (const candidate of candidates) {
		const entry = cleanTranscript.get(candidate.roundNumber);
		if (!entry) continue;

		// Extract a 1-2 sentence excerpt (best-effort)
		const snippet = extractSnippet(entry);
		if (snippet.length === 0) continue;

		// Header overhead: "> **Round N:** " + snippet + "\n\n"
		const headerOverhead = `> **Round ${candidate.roundNumber}:** `.length;
		const entryChars = headerOverhead + snippet.length + 2; // +2 for newlines

		if (usedChars + entryChars > budgetChars) break;

		selected.push({ roundNumber: candidate.roundNumber, snippet });
		usedChars += entryChars;
	}

	if (selected.length === 0) {
		return { text: "", sourceRounds: [] };
	}

	// Render in ascending roundNumber order
	selected.sort((a, b) => a.roundNumber - b.roundNumber);

	const sourceRounds = selected.map((s) => s.roundNumber);
	const lines = selected.map(
		(s) => `> **Round ${s.roundNumber}:** ${s.snippet}`,
	);
	const text = `## Key Quotes\n\n${lines.join("\n\n")}`;

	return { text, sourceRounds };
}

/**
 * Extracts a best-effort 1-2 sentence snippet from a round's transcript.
 * Takes the first available side's text, extracts the first 1-2 sentences.
 */
function extractSnippet(entry: {
	proposer?: string;
	challenger?: string;
}): string {
	const text = entry.proposer || entry.challenger || "";
	if (text.length === 0) return "";

	// Extract first 1-2 sentences
	const sentences = text.match(/[^.!?]+[.!?]+/g);
	if (sentences && sentences.length > 0) {
		const excerpt = sentences.slice(0, 2).join("").trim();
		// Cap at 200 chars
		return excerpt.length > 200 ? `${excerpt.slice(0, 197)}...` : excerpt;
	}

	// No sentence boundaries found — use first 200 chars
	return text.length > 200 ? `${text.slice(0, 197)}...` : text.trim();
}

/** Reconstructs a cleanTranscript from state.turns via stripInternalBlocks. */
function reconstructCleanTranscript(
	turns: DebateState["turns"],
): Map<number, { proposer?: string; challenger?: string }> {
	const transcript = new Map<
		number,
		{ proposer?: string; challenger?: string }
	>();
	for (const turn of turns) {
		if (!transcript.has(turn.roundNumber)) {
			transcript.set(turn.roundNumber, {});
		}
		const entry = transcript.get(turn.roundNumber)!;
		entry[turn.role] = stripInternalBlocks(turn.content);
	}
	return transcript;
}

/** Debug metadata returned alongside the adaptive synthesis prompt */
export interface SynthesisDebugMetadata {
	budgetTier: "short" | "medium" | "long";
	totalEstimatedTokens: number;
	budgetTokens: number;
	scores: ScoredRound[];
	fullTextRounds: number[];
	compressedRounds: number[];
	roundDisposition: Array<{
		roundNumber: number;
		disposition:
			| "fullText"
			| "compressed"
			| "phaseBlockCovered"
			| "degradedSummary";
	}>;
	fitAchieved: boolean;
	warnings: string[];
	shrinkTrace: Array<{
		step: string;
		beforeTokens: number;
		afterTokens: number;
		detail?: string;
	}>;
	referenceScoreUsed: boolean;
	quoteSnippetSourceRounds: number[];
	phaseBlocks?: Array<{
		phaseId: string;
		coveredRounds: number[];
		excludedPromotedRounds?: number[];
	}>;
}

/** Input for assembleAdaptiveSynthesisPrompt() */
export interface AdaptiveSynthesisInput {
	state: DebateState;
	plan: EvolvingPlan;
	topic: string;
	cleanTranscript?: Map<number, { proposer?: string; challenger?: string }>;
	config: SynthesisPromptConfig;
	referenceScores?: Map<number, number>;
}

/** Result of assembleAdaptiveSynthesisPrompt() */
export interface AdaptiveSynthesisResult {
	prompt: string;
	debug: SynthesisDebugMetadata;
}

/**
 * Conservative token estimation: always Math.ceil(text.length * 0.5)
 */
export function estimateTokens(text: string): number {
	if (text.length === 0) return 0;
	return Math.ceil(text.length * 0.5);
}

/**
 * Detects if text is majority CJK (>30% of chars in CJK Unicode ranges)
 * CJK ranges: U+4E00-U+9FFF (CJK Unified Ideographs), U+3400-U+4DBF (CJK Extension A)
 */
export function detectCjkMajority(text: string): boolean {
	if (text.length === 0) return false;

	let cjkCount = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.codePointAt(i);
		if (code === undefined) continue;

		// CJK Unified Ideographs: U+4E00-U+9FFF
		// CJK Extension A: U+3400-U+4DBF
		if (
			(code >= 0x4e00 && code <= 0x9fff) ||
			(code >= 0x3400 && code <= 0x4dbf)
		) {
			cjkCount++;
		}

		// Skip next char if this is a surrogate pair
		if (code > 0xffff) {
			i++;
		}
	}

	return cjkCount / text.length > 0.3;
}

/**
 * Renders Layer 1 of the adaptive synthesis prompt: structured plan context.
 *
 * Always includes the topic. Conditionally includes non-empty sections:
 * consensus, unresolved, risks, evidence, compressed judge notes, round summaries.
 *
 * Judge notes are compressed per spec Section 3 Layer 1:
 * each entry shows round number, leading side, confidence shift (when computable),
 * and a one-line rationale.
 */
export function buildLayer1(plan: EvolvingPlan, topic: string): string {
	const sections: string[] = [];

	// Topic is always included
	sections.push(`## Topic\n\n${topic}`);

	// Consensus
	if (plan.consensus.length > 0) {
		const items = plan.consensus.map((c) => `- ${c}`).join("\n");
		sections.push(`## Consensus\n\n${items}`);
	}

	// Unresolved
	if (plan.unresolved.length > 0) {
		const items = plan.unresolved.map((u) => `- ${u}`).join("\n");
		sections.push(`## Unresolved\n\n${items}`);
	}

	// Risks
	if (plan.risks.length > 0) {
		const items = plan.risks
			.map((r) => `- [${r.severity}] ${r.risk} (round ${r.round})`)
			.join("\n");
		sections.push(`## Risks\n\n${items}`);
	}

	// Evidence
	if (plan.evidence.length > 0) {
		const items = plan.evidence
			.map((e) => `- ${e.claim} (source: ${e.source}, round ${e.round})`)
			.join("\n");
		sections.push(`## Evidence\n\n${items}`);
	}

	// Compressed judge notes
	if (plan.judgeNotes.length > 0) {
		const signals = plan.roundSignals ?? [];
		const lines: string[] = [];
		for (let i = 0; i < plan.judgeNotes.length; i++) {
			const note = plan.judgeNotes[i];
			const prev = i > 0 ? plan.judgeNotes[i - 1] : undefined;

			let shiftPart = "";
			if (note.score && prev?.score) {
				const currentSpread = Math.abs(
					note.score.proposer - note.score.challenger,
				);
				const prevSpread = Math.abs(
					prev.score.proposer - prev.score.challenger,
				);
				const shift = currentSpread - prevSpread;
				// Round to avoid floating point noise
				const rounded = Math.round(shift * 100) / 100;
				const sign = rounded > 0 ? "+" : "";
				const formatted = Number.isInteger(rounded)
					? rounded.toFixed(1)
					: String(rounded);
				shiftPart = `, shift: ${sign}${formatted}`;
			}

			// Direction-change marker from RoundSignals (Phase 2)
			let directionPart = "";
			const sig = signals.find((s) => s.roundNumber === note.roundNumber);
			if (sig?.judgeImpact.directionChange) {
				directionPart = " ⟳ direction change";
			}

			const rationale = note.reasoning.replace(/\n/g, " ").trim();
			lines.push(
				`- R${note.roundNumber}: leading=${note.leading}${shiftPart}${directionPart} | ${rationale}`,
			);
		}
		sections.push(`## Judge Notes\n\n${lines.join("\n")}`);
	}

	// Round summaries
	if (plan.roundSummaries.length > 0) {
		const items = plan.roundSummaries
			.filter((s) => s.length > 0)
			.map((s) => `- ${s}`)
			.join("\n");
		if (items.length > 0) {
			sections.push(`## Round Summaries\n\n${items}`);
		}
	}

	return sections.join("\n\n");
}

/**
 * Transitional wrapper that delegates to assembleAdaptiveSynthesisPrompt().
 *
 * Reconstructs a cleanTranscript from state.turns via stripInternalBlocks(),
 * synthesises a best-effort EvolvingPlan from judgeNotes / roundSummaries,
 * then returns only the prompt string for backward compatibility.
 */
export function buildFullTextSynthesisPrompt(
	state: DebateState,
	judgeNotes: JudgeNote[],
	config: SynthesisPromptConfig,
	roundSummaries?: string[],
): string {
	const cleanTranscript = reconstructCleanTranscript(state.turns);

	// Synthesize a best-effort EvolvingPlan from legacy parameters
	const plan: EvolvingPlan = {
		...emptyPlan(),
		judgeNotes: judgeNotes.map((jn) => ({
			roundNumber: jn.roundNumber,
			leading: jn.leading,
			reasoning: jn.reasoning,
			...(jn.score ? { score: jn.score } : {}),
		})),
		roundSummaries: roundSummaries ?? [],
	};

	// Delegate to the adaptive prompt assembler
	const result = assembleAdaptiveSynthesisPrompt({
		state,
		plan,
		topic: state.config.topic,
		cleanTranscript,
		config,
	});

	// Prepend synthesis instructions (same as old behavior)
	const instructions = buildInstructions(result.debug.budgetTier);
	let prompt = `${instructions}\n\n${result.prompt}`;

	// Append full judge verdicts for backward compatibility.
	// The adaptive prompt compresses judge notes in Layer 1, but legacy callers
	// expect the full reasoning text to be present.
	if (judgeNotes.length > 0) {
		let verdicts = "\n\n## Judge Verdicts\n\n";
		for (const note of judgeNotes) {
			verdicts += `**Round ${note.roundNumber}** (Leading: ${note.leading}):\n\n`;
			verdicts += `${note.reasoning}\n\n`;
		}
		prompt += verdicts;
	}

	return prompt;
}

export function buildInstructions(tier?: "short" | "medium" | "long"): string {
	let instructions = `# Synthesis Task

You are synthesizing a comprehensive action plan from a structured adversarial debate.

Your goal is to produce a deeply actionable, well-organized report that captures:
- Areas of consensus and concrete action items
- Unresolved disagreements and their underlying reasoning
- Key argument evolution through the debate
- Risk matrix with specific mitigation strategies
- Evidence registry tracking which side cited what

## Recommended Structure

1. **Executive Summary** — 2-3 paragraphs: core conclusions, key value generated
2. **Consensus Action Items** — items BOTH sides genuinely agree on, with concrete next steps
3. **Unresolved Disagreements** — both positions, associated risks, suggested exploration
4. **Key Argument Evolution** — 3-5 most important arguments and how they developed
5. **Risk Matrix** — with SPECIFIC mitigation strategies, never "requires further analysis"
6. **Evidence Registry** — mark which side cited it and whether it was contested

## Quality Standards

- **Quality over quantity**: 3 deep consensus items > 30 shallow bullet points
- **Actionability**: every recommendation should be concrete and testable
- **Completeness**: address all major points raised, even if briefly
- **Balance**: fairly represent both sides' strongest arguments
- **Clarity**: use clear language, avoid jargon unless necessary
- Distinguish genuine bilateral consensus from one-sided concessions
- For risks, provide actionable mitigation based on what was discussed in the debate
- Prefer the listed section order; omit empty sections, but do not invent unrelated top-level sections`;

	if (tier === "medium" || tier === "long") {
		instructions +=
			"\n\n**Note:** Earlier rounds have been compressed to save context space. The structured plan above captures the key points; the most recent rounds are shown in full.";
	}

	instructions += `

## Important Constraints

- **DO NOT explore the codebase or use tools.** All information you need is provided in the transcript and structured plan above.
- Synthesize ONLY from the debate content provided. Do not run commands, read files, or start subagents.
- If information seems incomplete, note the gap in your synthesis rather than investigating it yourself.`;

	instructions +=
		"\n\nNow, here is the debate transcript and judge feedback:\n";

	return instructions;
}

/**
 * Builds a compressed representation of a single debate round for Layer 2.
 *
 * Rendering strategy:
 * 1. If round is degraded (in plan.degradedRounds): use roundSummary from
 *    RoundAnalysis if available, otherwise stripped transcript excerpt. No rich data.
 * 2. If RoundAnalysis exists and round is not degraded: rich rendering with
 *    new claims, challenged arguments, consensus, divergence, risks, evidence,
 *    summary, and stance/confidence from state.turns[].meta.
 * 3. If no RoundAnalysis exists: fall back to plan.roundSummaries[roundNumber-1],
 *    or stripped transcript excerpt if that is also missing.
 */
export function buildCompressedRound(
	roundNumber: number,
	plan: EvolvingPlan,
	state: DebateState,
): string {
	const isDegraded = plan.degradedRounds.includes(roundNumber);
	const analysis = (plan.roundAnalyses ?? []).find(
		(a) => a.roundNumber === roundNumber,
	);
	const roundTurns = state.turns.filter((t) => t.roundNumber === roundNumber);

	const sections: string[] = [];
	sections.push(`### Round ${roundNumber}`);

	if (isDegraded) {
		// Degraded: summary only, no rich data
		const summary = analysis?.roundSummary;
		if (summary) {
			sections.push(summary);
		} else {
			sections.push(buildTranscriptExcerpt(roundTurns));
		}
		return sections.join("\n\n");
	}

	if (analysis) {
		// Rich rendering from RoundAnalysis
		sections.push(buildRichContent(analysis, roundTurns));
		return sections.join("\n\n");
	}

	// Fallback: roundSummaries or transcript
	const summaryText = plan.roundSummaries[roundNumber - 1];
	if (summaryText && summaryText.length > 0) {
		sections.push(summaryText);
	} else {
		sections.push(buildTranscriptExcerpt(roundTurns));
	}

	return sections.join("\n\n");
}

/** Renders rich compressed content from a RoundAnalysis and turn metadata. */
function buildRichContent(
	analysis: RoundAnalysis,
	roundTurns: DebateState["turns"],
): string {
	const parts: string[] = [];

	// New claims
	if (analysis.newArguments.length > 0) {
		const items = analysis.newArguments
			.map((a) => `- [${a.side}] (${a.strength}) ${a.argument}`)
			.join("\n");
		parts.push(`**New Claims:**\n${items}`);
	}

	// Challenged arguments
	if (analysis.challengedArguments.length > 0) {
		const items = analysis.challengedArguments
			.map(
				(a) =>
					`- ${a.argument} — challenged by ${a.challengedBy}, outcome: ${a.outcome}`,
			)
			.join("\n");
		parts.push(`**Challenged Arguments:**\n${items}`);
	}

	// Consensus
	if (analysis.newConsensus.length > 0) {
		const items = analysis.newConsensus.map((c) => `- ${c}`).join("\n");
		parts.push(`**New Consensus:**\n${items}`);
	}

	// Divergence
	if (analysis.newDivergence.length > 0) {
		const items = analysis.newDivergence.map((d) => `- ${d}`).join("\n");
		parts.push(`**New Divergence:**\n${items}`);
	}

	// Risks
	if (analysis.risksIdentified.length > 0) {
		const items = analysis.risksIdentified
			.map((r) => `- [${r.severity}] ${r.risk} (raised by ${r.raisedBy})`)
			.join("\n");
		parts.push(`**Risks:**\n${items}`);
	}

	// Evidence
	if (analysis.evidenceCited.length > 0) {
		const items = analysis.evidenceCited
			.map((e) => `- ${e.claim} (source: ${e.source}, side: ${e.side})`)
			.join("\n");
		parts.push(`**Evidence:**\n${items}`);
	}

	// Round summary
	if (analysis.roundSummary) {
		parts.push(`**Summary:** ${analysis.roundSummary}`);
	}

	// Stance/confidence from turn metadata
	const stanceLines: string[] = [];
	for (const turn of roundTurns) {
		if (turn.meta) {
			const role = turn.role === "proposer" ? "Proposer" : "Challenger";
			stanceLines.push(
				`- ${role}: stance=${turn.meta.stance}, confidence=${turn.meta.confidence}`,
			);
		}
	}
	if (stanceLines.length > 0) {
		parts.push(`**Stance/Confidence:**\n${stanceLines.join("\n")}`);
	}

	return parts.join("\n\n");
}

// --- Budget tier selection (spec Section 5) ---

/**
 * Chooses the initial budget tier for the synthesis prompt.
 *
 * - short: fullEstimateTokens <= budgetTokens * 0.6
 * - medium: exceeds short, rounds <= 20, and estimate fits within budgetTokens * 0.85
 * - long: rounds > 20 OR medium estimate still does not fit
 */
export function chooseInitialBudgetTier(
	totalRounds: number,
	fullEstimateTokens: number,
	budgetTokens: number,
): "short" | "medium" | "long" {
	if (fullEstimateTokens <= budgetTokens * 0.6) {
		return "short";
	}

	if (totalRounds > 20) {
		return "long";
	}

	// Medium: compression allows higher ratio
	if (fullEstimateTokens <= budgetTokens * 0.85) {
		return "medium";
	}

	return "long";
}

// --- Phase block types and assembly (spec Section 5.1) ---

export interface PhaseBlock {
	phaseId: string;
	coveredRounds: number[];
	content: string;
}

/**
 * Aggregates content for a phase block over an arbitrary subset of rounds.
 *
 * Designed to accept any subset so Phase 2 can re-aggregate after promoting
 * rounds without code changes (spec Section 5.1, line 369).
 *
 * Aggregation includes:
 * - Union-deduped claims (from RoundAnalysis.newArguments)
 * - Merged concessions (from challengedArguments where outcome is "conceded")
 * - Merged risk deltas (from risksIdentified)
 * - Judge swing (first leading -> last leading in window)
 * - Stance trajectory from state.turns[].meta
 */
export function aggregatePhaseBlockContent(
	rounds: number[],
	plan: EvolvingPlan,
	state: DebateState,
): string {
	if (rounds.length === 0) return "";

	const analyses = (plan.roundAnalyses ?? []).filter(
		(a) =>
			rounds.includes(a.roundNumber) &&
			!plan.degradedRounds.includes(a.roundNumber),
	);

	const parts: string[] = [];

	// Union-deduped claims
	const seenClaims = new Set<string>();
	const claims: string[] = [];
	for (const a of analyses) {
		for (const arg of a.newArguments) {
			if (!seenClaims.has(arg.argument)) {
				seenClaims.add(arg.argument);
				claims.push(`- [${arg.side}] (${arg.strength}) ${arg.argument}`);
			}
		}
	}
	if (claims.length > 0) {
		parts.push(`**Claims:**\n${claims.join("\n")}`);
	}

	// Merged concessions (outcome === "conceded")
	const seenConcessions = new Set<string>();
	const concessions: string[] = [];
	for (const a of analyses) {
		for (const ca of a.challengedArguments) {
			if (ca.outcome === "conceded" && !seenConcessions.has(ca.argument)) {
				seenConcessions.add(ca.argument);
				concessions.push(`- ${ca.argument} (conceded by ${ca.challengedBy})`);
			}
		}
	}
	if (concessions.length > 0) {
		parts.push(`**Concessions:**\n${concessions.join("\n")}`);
	}

	// Merged risk deltas
	const seenRisks = new Set<string>();
	const risks: string[] = [];
	for (const a of analyses) {
		for (const r of a.risksIdentified) {
			if (!seenRisks.has(r.risk)) {
				seenRisks.add(r.risk);
				risks.push(`- [${r.severity}] ${r.risk} (raised by ${r.raisedBy})`);
			}
		}
	}
	if (risks.length > 0) {
		parts.push(`**Risks:**\n${risks.join("\n")}`);
	}

	// Judge swing: first leading -> last leading in window
	const windowJudgeNotes = plan.judgeNotes.filter((jn) =>
		rounds.includes(jn.roundNumber),
	);
	if (windowJudgeNotes.length > 0) {
		const sorted = [...windowJudgeNotes].sort(
			(a, b) => a.roundNumber - b.roundNumber,
		);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		parts.push(
			`**Judge Swing:** ${first.leading} (R${first.roundNumber}) -> ${last.leading} (R${last.roundNumber})`,
		);
	}

	// Stance trajectory from turn meta
	const roundTurns = state.turns
		.filter((t) => rounds.includes(t.roundNumber) && t.meta)
		.sort((a, b) => a.roundNumber - b.roundNumber);
	if (roundTurns.length > 0) {
		const stanceLines: string[] = [];
		for (const turn of roundTurns) {
			if (turn.meta) {
				const role = turn.role === "proposer" ? "Proposer" : "Challenger";
				stanceLines.push(
					`- R${turn.roundNumber} ${role}: stance=${turn.meta.stance}, confidence=${turn.meta.confidence}`,
				);
			}
		}
		if (stanceLines.length > 0) {
			parts.push(`**Stance Trajectory:**\n${stanceLines.join("\n")}`);
		}
	}

	return parts.join("\n\n");
}

/**
 * Splits an array of round numbers into contiguous sub-arrays.
 * e.g., [1, 2, 3, 5, 6, 8] -> [[1, 2, 3], [5, 6], [8]]
 */
function splitIntoContiguousRuns(rounds: number[]): number[][] {
	if (rounds.length === 0) return [];
	const sorted = [...rounds].sort((a, b) => a - b);
	const runs: number[][] = [[sorted[0]]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === sorted[i - 1] + 1) {
			runs[runs.length - 1].push(sorted[i]);
		} else {
			runs.push([sorted[i]]);
		}
	}
	return runs;
}

/**
 * Builds phase blocks from the earliest compressed region.
 *
 * Rules (spec Section 5.1):
 * - Default window size 3
 * - Blocks must be contiguous in round space
 * - Empty blocks are dropped
 * - Degraded rounds appear in coveredRounds but do not contribute semantic aggregates
 * - Non-contiguous inputs are split into contiguous runs first
 */
export function buildPhaseBlocks(
	compressedRounds: number[],
	plan: EvolvingPlan,
	state: DebateState,
	windowSize = 3,
): PhaseBlock[] {
	if (compressedRounds.length === 0) return [];

	// First split into contiguous runs to enforce contiguity invariant
	const contiguousRuns = splitIntoContiguousRuns(compressedRounds);

	const blocks: PhaseBlock[] = [];
	let phaseCounter = 1;

	for (const run of contiguousRuns) {
		// Chunk each contiguous run into windows
		for (let i = 0; i < run.length; i += windowSize) {
			const chunk = run.slice(i, i + windowSize);
			const content = aggregatePhaseBlockContent(chunk, plan, state);

			// Drop empty blocks
			if (content.length === 0) continue;

			blocks.push({
				phaseId: `phase-${phaseCounter}`,
				coveredRounds: chunk,
				content,
			});
			phaseCounter++;
		}
	}

	return blocks;
}

// --- assembleAdaptiveSynthesisPrompt (Task 7: Phase 1) ---

/**
 * Assembles the adaptive synthesis prompt using a tiered strategy.
 *
 * Phase 1 selection rule: recency only (no scoring rescue).
 * Never throws; returns best-effort output on any error.
 */
export function assembleAdaptiveSynthesisPrompt(
	input: AdaptiveSynthesisInput,
): AdaptiveSynthesisResult {
	try {
		return assembleAdaptiveSynthesisPromptInner(input);
	} catch (err) {
		// Best-effort: return a minimal result with the error in warnings
		const layer1 = buildLayer1(input.plan, input.topic);
		const norm = normalizeConfig(input.config);
		return {
			prompt: layer1,
			debug: {
				budgetTier: "short",
				totalEstimatedTokens: estimateTokens(layer1),
				budgetTokens: norm.contextTokenLimit,
				scores: [],
				fullTextRounds: [],
				compressedRounds: [],
				roundDisposition: [],
				fitAchieved: true,
				warnings: [
					`assembleAdaptiveSynthesisPrompt caught error: ${err instanceof Error ? err.message : String(err)}`,
				],
				shrinkTrace: [],
				referenceScoreUsed: false,
				quoteSnippetSourceRounds: [],
			},
		};
	}
}

function assembleAdaptiveSynthesisPromptInner(
	input: AdaptiveSynthesisInput,
): AdaptiveSynthesisResult {
	const { state, plan, topic } = input;
	const norm = normalizeConfig(input.config);
	const warnings: string[] = [];

	// --- Build or reconstruct cleanTranscript ---
	let transcript: Map<number, { proposer?: string; challenger?: string }>;
	if (input.cleanTranscript && input.cleanTranscript.size > 0) {
		transcript = input.cleanTranscript;
	} else {
		transcript = reconstructCleanTranscript(state.turns);
		if (state.turns.length > 0) {
			warnings.push(
				"cleanTranscript was empty; reconstructed from state.turns",
			);
		}
	}

	// --- Compute round universe (union of all sources) ---
	const roundSet = new Set<number>();

	// From cleanTranscript
	for (const r of transcript.keys()) {
		roundSet.add(r);
	}

	// From state.turns
	for (const turn of state.turns) {
		roundSet.add(turn.roundNumber);
	}

	// From plan.roundSummaries (index+1 for non-empty entries)
	for (let i = 0; i < plan.roundSummaries.length; i++) {
		if (plan.roundSummaries[i].length > 0) {
			roundSet.add(i + 1);
		}
	}

	const allRounds = Array.from(roundSet).sort((a, b) => a - b);
	const totalRounds = allRounds.length;

	if (totalRounds === 0) {
		const layer1 = buildLayer1(plan, topic);
		return {
			prompt: layer1,
			debug: {
				budgetTier: "short",
				totalEstimatedTokens: estimateTokens(layer1),
				budgetTokens: norm.contextTokenLimit,
				scores: [],
				fullTextRounds: [],
				compressedRounds: [],
				roundDisposition: [],
				fitAchieved: true,
				warnings,
				shrinkTrace: [],
				referenceScoreUsed: false,
				quoteSnippetSourceRounds: [],
			},
		};
	}

	// --- Determine which rounds can be rendered full text ---
	// A round can be full text only if it has at least one side in transcript
	function hasTranscript(r: number): boolean {
		const entry = transcript.get(r);
		if (!entry) return false;
		return Boolean(entry.proposer) || Boolean(entry.challenger);
	}

	// --- Estimate full-text cost for tier selection ---
	const layer1Text = buildLayer1(plan, topic);
	let fullEstimate = estimateTokens(layer1Text);
	for (const r of allRounds) {
		if (hasTranscript(r)) {
			const entry = transcript.get(r)!;
			const roundText = renderFullTextRound(r, entry);
			fullEstimate += estimateTokens(roundText);
		} else {
			const compressed = buildCompressedRound(r, plan, state);
			fullEstimate += estimateTokens(compressed);
		}
	}

	const budgetTokens = norm.contextTokenLimit;
	const tier = chooseInitialBudgetTier(totalRounds, fullEstimate, budgetTokens);

	// --- Determine full-text vs compressed per round ---
	const fullTextRounds: number[] = [];
	const compressedRounds: number[] = [];
	let scoredRounds: ScoredRound[] = [];

	if (tier === "short") {
		// All rounds with transcript get full text; others degrade
		for (const r of allRounds) {
			if (hasTranscript(r)) {
				fullTextRounds.push(r);
			} else {
				compressedRounds.push(r);
			}
		}
	} else {
		// medium / long: use scoring when roundSignals available, fallback to recency-only
		const signals = plan.roundSignals ?? [];

		if (signals.length > 0) {
			// Scoring-aware path
			const scores = scoreRoundsForSynthesis(
				totalRounds,
				signals,
				plan.degradedRounds,
				input.referenceScores,
			);
			const selection = selectCriticalRounds(
				scores,
				totalRounds,
				norm.recentK,
				norm.impactM,
			);

			// Populate scored rounds for debug metadata
			scoredRounds = scores;

			for (const r of allRounds) {
				if (selection.fullText.has(r) && hasTranscript(r)) {
					fullTextRounds.push(r);
				} else {
					compressedRounds.push(r);
				}
			}
		} else {
			// Recency-only fallback (Phase 1 behavior)
			const recentK = norm.recentK;
			const recentCutoff =
				allRounds.length >= recentK
					? allRounds[allRounds.length - recentK]
					: allRounds[0];

			for (const r of allRounds) {
				if (r >= recentCutoff && hasTranscript(r)) {
					fullTextRounds.push(r);
				} else {
					compressedRounds.push(r);
				}
			}
		}
	}

	// --- Build the prompt ---
	const promptParts: string[] = [];

	// Layer 1 always first
	promptParts.push(layer1Text);

	// Context note for medium/long
	if (tier === "medium" || tier === "long") {
		promptParts.push(
			"Note: Earlier rounds have been compressed to fit the context window. The most recent rounds are shown in full.",
		);
	}

	// Phase blocks for long tier (earliest compressed region)
	let phaseBlocks: PhaseBlock[] | undefined;
	const phaseBlockDebug: SynthesisDebugMetadata["phaseBlocks"] = [];

	// Compute earliest compressed region: compressed rounds before the first full-text round
	const firstFullTextRound =
		fullTextRounds.length > 0 ? fullTextRounds[0] : Number.POSITIVE_INFINITY;
	const earliestCompressed =
		tier === "long"
			? compressedRounds.filter((r) => r < firstFullTextRound)
			: [];

	if (earliestCompressed.length > 0) {
		phaseBlocks = buildPhaseBlocks(earliestCompressed, plan, state);
	}

	// Render rounds in ascending order
	let fullTextSet = new Set(fullTextRounds);
	const phaseBlockCoveredRounds = new Set<number>();

	// Compute promoted rounds from earliest compressed region for debug metadata
	const promotedFromEarliest =
		earliestCompressed.length > 0
			? fullTextRounds.filter(
					(r) =>
						r >= earliestCompressed[0] &&
						r <= earliestCompressed[earliestCompressed.length - 1],
				)
			: [];

	if (phaseBlocks && phaseBlocks.length > 0) {
		// Render phase blocks in order, then remaining compressed/full rounds
		for (const block of phaseBlocks) {
			for (const r of block.coveredRounds) {
				phaseBlockCoveredRounds.add(r);
			}

			// Track which rounds were promoted out of this block's window
			const blockMin = block.coveredRounds[0];
			const blockMax = block.coveredRounds[block.coveredRounds.length - 1];
			const excludedPromoted = promotedFromEarliest.filter(
				(r) => r >= blockMin && r <= blockMax,
			);

			phaseBlockDebug.push({
				phaseId: block.phaseId,
				coveredRounds: block.coveredRounds,
				...(excludedPromoted.length > 0
					? { excludedPromotedRounds: excludedPromoted }
					: {}),
			});
			promptParts.push(
				`## ${block.phaseId} (Rounds ${block.coveredRounds[0]}-${block.coveredRounds[block.coveredRounds.length - 1]})\n\n${block.content}`,
			);
		}
	}

	for (const r of allRounds) {
		if (phaseBlockCoveredRounds.has(r)) {
			continue; // Already rendered as part of phase block
		}

		if (fullTextSet.has(r)) {
			const entry = transcript.get(r)!;
			promptParts.push(renderFullTextRound(r, entry));
		} else {
			promptParts.push(buildCompressedRound(r, plan, state));
		}
	}

	// --- Layer 4: Quote snippets (Phase 3) ---
	let snippetText = "";
	let quoteSnippetSourceRounds: number[] = [];
	const currentSnippetBudget = norm.quoteSnippetBudgetChars;

	if (
		tier !== "short" &&
		compressedRounds.length > 0 &&
		scoredRounds.length > 0
	) {
		const snippetResult = buildQuoteSnippets(
			transcript,
			compressedRounds,
			scoredRounds,
			currentSnippetBudget,
		);
		snippetText = snippetResult.text;
		quoteSnippetSourceRounds = snippetResult.sourceRounds;

		if (snippetText.length > 0) {
			promptParts.push(snippetText);
		}
	}

	let prompt = promptParts.join("\n\n");
	let totalEstimatedTokens = estimateTokens(prompt);
	let fitAchieved = totalEstimatedTokens <= budgetTokens;
	let shrinkTrace: SynthesisDebugMetadata["shrinkTrace"] = [];

	// --- Shrink if over budget ---
	if (!fitAchieved) {
		const shrinkSections: ShrinkSections = {
			layer1: layer1Text,
			debateTimeline: allRounds
				.filter((r) => !phaseBlockCoveredRounds.has(r))
				.map((r) => {
					if (fullTextSet.has(r)) {
						const entry = transcript.get(r)!;
						return {
							roundNumber: r,
							type: "fullText" as const,
							content: renderFullTextRound(r, entry),
						};
					}
					return {
						roundNumber: r,
						type: "compressed" as const,
						content: buildCompressedRound(r, plan, state),
					};
				}),
			contextNote:
				tier === "medium" || tier === "long"
					? "Note: Earlier rounds have been compressed to fit the context window. The most recent rounds are shown in full."
					: "",
			snippetSection: snippetText.length > 0 ? snippetText : undefined,
		};

		// Add phase block entries to the timeline
		if (phaseBlocks && phaseBlocks.length > 0) {
			for (const block of phaseBlocks) {
				shrinkSections.debateTimeline.unshift({
					roundNumber: block.coveredRounds[0],
					type: "phaseBlock",
					content: `## ${block.phaseId} (Rounds ${block.coveredRounds[0]}-${block.coveredRounds[block.coveredRounds.length - 1]})\n\n${block.content}`,
				});
			}
		}

		const shrinkResult = shrinkToFit(
			shrinkSections,
			budgetTokens,
			norm.recentK,
			fullTextRounds,
			compressedRounds,
			plan,
			state,
			// Snippet context for cutSnippets step
			snippetText.length > 0
				? {
						transcript,
						scored: scoredRounds,
						initialBudgetChars: currentSnippetBudget,
					}
				: undefined,
		);

		prompt = shrinkResult.prompt;
		totalEstimatedTokens = estimateTokens(prompt);
		fitAchieved = shrinkResult.fitAchieved;
		shrinkTrace = shrinkResult.shrinkTrace;
		// Update fullTextRounds/compressedRounds from shrink result
		fullTextRounds.length = 0;
		fullTextRounds.push(...shrinkResult.updatedFullTextRounds);
		compressedRounds.length = 0;
		compressedRounds.push(...shrinkResult.updatedCompressedRounds);
		fullTextSet = new Set(fullTextRounds);
		// Update snippet source rounds from shrink result
		if (shrinkResult.updatedSnippetSourceRounds) {
			quoteSnippetSourceRounds = shrinkResult.updatedSnippetSourceRounds;
		}
	}

	// --- Build round disposition ---
	const roundDisposition: SynthesisDebugMetadata["roundDisposition"] = [];
	const degradedSet = new Set(plan.degradedRounds);
	for (const r of allRounds) {
		let disposition:
			| "fullText"
			| "compressed"
			| "phaseBlockCovered"
			| "degradedSummary";
		if (fullTextSet.has(r)) {
			disposition = "fullText";
		} else if (degradedSet.has(r) && !phaseBlockCoveredRounds.has(r)) {
			disposition = "degradedSummary";
		} else if (phaseBlockCoveredRounds.has(r)) {
			disposition = "phaseBlockCovered";
		} else if (!hasTranscript(r) && tier === "short") {
			// In short tier, a round without transcript is a degraded summary
			disposition = "degradedSummary";
		} else {
			disposition = "compressed";
		}
		roundDisposition.push({ roundNumber: r, disposition });
	}

	return {
		prompt,
		debug: {
			budgetTier: tier,
			totalEstimatedTokens,
			budgetTokens,
			scores: scoredRounds,
			fullTextRounds,
			compressedRounds,
			roundDisposition,
			fitAchieved,
			warnings,
			shrinkTrace,
			referenceScoreUsed:
				(input.referenceScores?.size ?? 0) > 0 && scoredRounds.length > 0,
			quoteSnippetSourceRounds,
			phaseBlocks: phaseBlockDebug.length > 0 ? phaseBlockDebug : undefined,
		},
	};
}

// --- Shrink algorithm (Task 8) ---

export interface ShrinkSections {
	layer1: string;
	debateTimeline: Array<{
		roundNumber: number;
		type: "fullText" | "compressed" | "phaseBlock";
		content: string;
	}>;
	contextNote: string;
	snippetSection?: string;
}

export interface ShrinkResult {
	prompt: string;
	shrinkTrace: SynthesisDebugMetadata["shrinkTrace"];
	fitAchieved: boolean;
	updatedFullTextRounds: number[];
	updatedCompressedRounds: number[];
	updatedSnippetText?: string;
	updatedSnippetSourceRounds?: number[];
}

/**
 * Iteratively shrinks an assembled prompt until it fits within the token budget.
 *
 * Steps are applied in strict order; each step is only recorded in shrinkTrace
 * if it actually reduced the token count. Stops as soon as fit is achieved.
 */
export function shrinkToFit(
	sections: ShrinkSections,
	budgetTokens: number,
	recentK: number,
	fullTextRounds: number[],
	compressedRounds: number[],
	plan: EvolvingPlan,
	state: DebateState,
	snippetContext?: {
		transcript: Map<number, { proposer?: string; challenger?: string }>;
		scored: ScoredRound[];
		initialBudgetChars: number;
	},
): ShrinkResult {
	const trace: SynthesisDebugMetadata["shrinkTrace"] = [];
	let currentLayer1 = sections.layer1;
	const currentTimeline = sections.debateTimeline.map((e) => ({ ...e }));
	let currentFullText = [...fullTextRounds];
	let currentCompressed = [...compressedRounds];
	let currentSnippetSection = sections.snippetSection ?? "";
	let currentSnippetSourceRounds: number[] | undefined;
	// Mutable copy of plan for summary truncation
	let currentPlan = {
		...plan,
		roundSummaries: [...plan.roundSummaries],
	};

	function assemble(): string {
		const parts: string[] = [currentLayer1];
		if (sections.contextNote) parts.push(sections.contextNote);
		for (const entry of currentTimeline) {
			parts.push(entry.content);
		}
		if (currentSnippetSection) parts.push(currentSnippetSection);
		return parts.join("\n\n");
	}

	function currentTokens(): number {
		return estimateTokens(assemble());
	}

	function fits(): boolean {
		return currentTokens() <= budgetTokens;
	}

	// Already fits? Return immediately.
	if (fits()) {
		return {
			prompt: assemble(),
			shrinkTrace: [],
			fitAchieved: true,
			updatedFullTextRounds: currentFullText,
			updatedCompressedRounds: currentCompressed,
		};
	}

	// --- Step 1: cutSnippets ---
	// Halve snippet budget and rebuild Layer 4 until fit or budget exhausted
	if (currentSnippetSection.length > 0 && snippetContext) {
		let snippetBudget = snippetContext.initialBudgetChars;
		const maxCuts = 3;
		for (let cut = 0; cut < maxCuts && !fits(); cut++) {
			const before = currentTokens();
			snippetBudget = Math.floor(snippetBudget / 2);

			if (snippetBudget <= 0) {
				currentSnippetSection = "";
				currentSnippetSourceRounds = [];
				const after = currentTokens();
				if (after < before) {
					trace.push({
						step: "cutSnippets",
						beforeTokens: before,
						afterTokens: after,
						detail: "budget exhausted, removed all snippets",
					});
				}
				break;
			}

			const newSnippets = buildQuoteSnippets(
				snippetContext.transcript,
				currentCompressed,
				snippetContext.scored,
				snippetBudget,
			);
			currentSnippetSection = newSnippets.text;
			currentSnippetSourceRounds = newSnippets.sourceRounds;

			const after = currentTokens();
			if (after < before) {
				trace.push({
					step: "cutSnippets",
					beforeTokens: before,
					afterTokens: after,
					detail: `budget halved to ${snippetBudget}`,
				});
			}
		}
	}

	if (fits()) {
		return buildResult();
	}

	// --- Step 2: demoteFullText ---
	// Iteratively demote the lowest-numbered full-text round (excluding recentK).
	let demotionOccurred = true;
	while (!fits() && demotionOccurred) {
		demotionOccurred = false;
		const allSorted = [...currentFullText].sort((a, b) => a - b);
		// Protected: the last recentK rounds
		const protectedCutoff =
			allSorted.length > recentK
				? allSorted[allSorted.length - recentK]
				: Number.NEGATIVE_INFINITY;

		const demotable = allSorted.filter((r) => r < protectedCutoff);
		if (demotable.length === 0) break;

		const target = demotable[0]; // lowest round number
		const before = currentTokens();

		// Re-render as compressed
		const compressed = buildCompressedRound(target, currentPlan, state);
		const idx = currentTimeline.findIndex(
			(e) => e.roundNumber === target && e.type === "fullText",
		);
		if (idx >= 0) {
			currentTimeline[idx] = {
				roundNumber: target,
				type: "compressed",
				content: compressed,
			};
		}
		currentFullText = currentFullText.filter((r) => r !== target);
		currentCompressed = [...currentCompressed, target].sort((a, b) => a - b);

		const after = currentTokens();
		if (after < before) {
			trace.push({
				step: "demoteFullText",
				beforeTokens: before,
				afterTokens: after,
				detail: `demoted round ${target}`,
			});
			demotionOccurred = true;
		}

		if (fits()) return buildResult();
	}

	// --- Step 3: trimSummaries ---
	// Sub-step 1: truncate to 80 chars
	{
		const before = currentTokens();
		let changed = false;
		for (let i = 0; i < currentPlan.roundSummaries.length; i++) {
			if (currentPlan.roundSummaries[i].length > 80) {
				currentPlan.roundSummaries[i] =
					`${currentPlan.roundSummaries[i].slice(0, 77)}...`;
				changed = true;
			}
		}
		if (changed) {
			// Re-render Layer 1
			currentLayer1 = buildLayer1(currentPlan, extractTopic(currentLayer1));
			const after = currentTokens();
			if (after < before) {
				trace.push({
					step: "trimSummaries",
					beforeTokens: before,
					afterTokens: after,
					detail: "truncated to 80 chars",
				});
			}
		}
	}

	if (fits()) return buildResult();

	// Sub-step 2: truncate to 40 chars
	{
		const before = currentTokens();
		let changed = false;
		for (let i = 0; i < currentPlan.roundSummaries.length; i++) {
			if (currentPlan.roundSummaries[i].length > 40) {
				currentPlan.roundSummaries[i] =
					`${currentPlan.roundSummaries[i].slice(0, 37)}...`;
				changed = true;
			}
		}
		if (changed) {
			currentLayer1 = buildLayer1(currentPlan, extractTopic(currentLayer1));
			const after = currentTokens();
			if (after < before) {
				trace.push({
					step: "trimSummaries",
					beforeTokens: before,
					afterTokens: after,
					detail: "truncated to 40 chars",
				});
			}
		}
	}

	if (fits()) return buildResult();

	// --- Step 4: compactLayer1 ---
	{
		const topic = extractTopic(currentLayer1);
		const before = currentTokens();
		let compactedPlan = { ...currentPlan };

		// 4.1: evidence — keep only top 5 by recency (highest round number)
		if (compactedPlan.evidence.length > 5) {
			compactedPlan = {
				...compactedPlan,
				evidence: [...compactedPlan.evidence]
					.sort((a, b) => b.round - a.round)
					.slice(0, 5),
			};
		}

		// 4.2: judgeNotes — reduce to terse marker (round + leading only)
		compactedPlan = {
			...compactedPlan,
			judgeNotes: compactedPlan.judgeNotes.map((jn) => ({
				...jn,
				reasoning: `${jn.leading}`,
			})),
		};

		// 4.3: unresolved/risks — keep only text/risk + severity + round; drop extended descriptions
		compactedPlan = {
			...compactedPlan,
			unresolved: compactedPlan.unresolved.map((u) =>
				u.length > 60 ? `${u.slice(0, 57)}...` : u,
			),
			risks: compactedPlan.risks.map((r) => ({
				risk: r.risk.length > 40 ? `${r.risk.slice(0, 37)}...` : r.risk,
				severity: r.severity,
				round: r.round,
			})),
		};

		// 4.4: consensus — truncate each item to 80 chars
		compactedPlan = {
			...compactedPlan,
			consensus: compactedPlan.consensus.map((c) =>
				c.length > 80 ? `${c.slice(0, 77)}...` : c,
			),
		};

		currentPlan = compactedPlan;
		currentLayer1 = buildLayer1(currentPlan, topic);

		const after = currentTokens();
		if (after < before) {
			trace.push({
				step: "compactLayer1",
				beforeTokens: before,
				afterTokens: after,
			});
		}
	}

	if (fits()) return buildResult();

	// --- Step 5: emergency ---
	// Drop Layer 4 entirely and truncate Layer 2 blocks to 2 lines each.
	{
		const before = currentTokens();
		let changed = false;

		// Drop any remaining snippet section
		if (currentSnippetSection.length > 0) {
			currentSnippetSection = "";
			currentSnippetSourceRounds = [];
			changed = true;
		}

		for (let i = 0; i < currentTimeline.length; i++) {
			const entry = currentTimeline[i];
			const lines = entry.content.split("\n");
			if (lines.length > 2) {
				currentTimeline[i] = {
					...entry,
					content: lines.slice(0, 2).join("\n"),
				};
				changed = true;
			}
		}

		if (changed) {
			const after = currentTokens();
			if (after < before) {
				trace.push({
					step: "emergency",
					beforeTokens: before,
					afterTokens: after,
				});
			}
		}
	}

	if (fits()) return buildResult();

	// --- Step 6: excerptRecent ---
	const excerptConfigs = [
		{ first: 500, last: 200 },
		{ first: 250, last: 100 },
		{ first: 100, last: 50 },
	];

	for (const cfg of excerptConfigs) {
		if (fits()) return buildResult();

		const before = currentTokens();
		let changed = false;

		for (let i = 0; i < currentTimeline.length; i++) {
			const entry = currentTimeline[i];
			if (entry.type !== "fullText") continue;

			// Excerpt each role block
			const excerpted = excerptRoleBlocks(entry.content, cfg.first, cfg.last);
			if (excerpted !== entry.content) {
				currentTimeline[i] = { ...entry, content: excerpted };
				changed = true;
			}
		}

		if (changed) {
			const after = currentTokens();
			if (after < before) {
				trace.push({
					step: "excerptRecent",
					beforeTokens: before,
					afterTokens: after,
					detail: `first ${cfg.first} + last ${cfg.last}`,
				});
			}
		}
	}

	return buildResult();

	function buildResult(): ShrinkResult {
		return {
			prompt: assemble(),
			shrinkTrace: trace,
			fitAchieved: fits(),
			updatedFullTextRounds: currentFullText,
			updatedCompressedRounds: currentCompressed,
			updatedSnippetText: currentSnippetSection || undefined,
			updatedSnippetSourceRounds: currentSnippetSourceRounds,
		};
	}
}

/** Extracts the topic from a Layer 1 string. */
function extractTopic(layer1: string): string {
	const match = layer1.match(/## Topic\n\n([^\n]+)/);
	return match?.[1] ?? "";
}

/**
 * Excerpts role blocks (Proposer/Challenger) to first N + last M chars.
 */
function excerptRoleBlocks(
	content: string,
	first: number,
	last: number,
): string {
	// Split on role headers like **Proposer:** and **Challenger:**
	return content.replace(
		/(\*\*(?:Proposer|Challenger):\*\*\n)([\s\S]*?)(?=\n\n\*\*(?:Proposer|Challenger):\*\*|$)/g,
		(match, header: string, body: string) => {
			if (body.length <= first + last + 10) return match;
			const excerpted = `${body.slice(0, first)}\n[...truncated...]\n${body.slice(-last)}`;
			return header + excerpted;
		},
	);
}

/** Renders a single round in full-text format per spec. */
function renderFullTextRound(
	roundNumber: number,
	entry: { proposer?: string; challenger?: string },
): string {
	const parts: string[] = [`### Round ${roundNumber}`];

	if (entry.proposer) {
		parts.push(`**Proposer:**\n${entry.proposer}`);
	}
	if (entry.challenger) {
		parts.push(`**Challenger:**\n${entry.challenger}`);
	}

	return parts.join("\n\n");
}

/** Builds a stripped transcript excerpt from turns, removing internal blocks. */
function buildTranscriptExcerpt(roundTurns: DebateState["turns"]): string {
	if (roundTurns.length === 0) {
		return "*No transcript available.*";
	}

	const parts: string[] = [];
	for (const turn of roundTurns) {
		const role = turn.role === "proposer" ? "Proposer" : "Challenger";
		const cleaned = stripInternalBlocks(turn.content);
		parts.push(`**${role}:** ${cleaned}`);
	}
	return parts.join("\n\n");
}
