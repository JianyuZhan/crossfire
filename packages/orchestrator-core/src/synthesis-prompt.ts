import type { EvolvingPlan } from "./evolving-plan.js";
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

/** Placeholder for Phase 2 scored round data */
export interface ScoredRound {
	roundNumber: number;
	score: number;
	breakdown: Record<string, number>;
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

			const rationale = note.reasoning.replace(/\n/g, " ").trim();
			lines.push(
				`- R${note.roundNumber}: leading=${note.leading}${shiftPart} | ${rationale}`,
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
 * Builds a full-text synthesis prompt from debate state, judge notes, and optional round summaries.
 * If the full prompt exceeds 60% of contextTokenLimit, it truncates early rounds while preserving:
 * - Last 2 rounds
 * - All judge verdicts
 * - 3rd-to-last round if it fits
 */
export function buildFullTextSynthesisPrompt(
	state: DebateState,
	judgeNotes: JudgeNote[],
	config: SynthesisPromptConfig,
	roundSummaries?: string[],
): string {
	// Instructions always in English per spec; output follows debate language
	const instructions = buildInstructions();

	// Build full prompt with all content
	const fullPrompt = buildPromptContent(
		state,
		judgeNotes,
		instructions,
		roundSummaries,
	);

	// Check token budget
	const estimatedTokens = estimateTokens(fullPrompt);
	const tokenBudget = config.contextTokenLimit * 0.6;

	if (estimatedTokens <= tokenBudget) {
		return fullPrompt;
	}

	// Over budget: truncate early rounds
	return buildTruncatedPrompt(
		state,
		judgeNotes,
		instructions,
		config,
		roundSummaries,
	);
}

function buildInstructions(): string {
	return `# Synthesis Task

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
- Prefer the listed section order; omit empty sections, but do not invent unrelated top-level sections

Now, here is the debate transcript and judge feedback:
`;
}

function buildPromptContent(
	state: DebateState,
	judgeNotes: JudgeNote[],
	instructions: string,
	roundSummaries?: string[],
): string {
	let content = instructions;
	content += "\n\n";

	// Add topic
	content += `## Topic\n\n${state.config.topic}\n\n`;

	// Add round summaries if provided
	if (roundSummaries && roundSummaries.length > 0) {
		content += "## Round Summaries\n\n";
		for (const summary of roundSummaries) {
			content += `${summary}\n\n`;
		}
	}

	// Group turns by round
	const turnsByRound = new Map<number, typeof state.turns>();
	for (const turn of state.turns) {
		if (!turnsByRound.has(turn.roundNumber)) {
			turnsByRound.set(turn.roundNumber, []);
		}
		turnsByRound.get(turn.roundNumber)?.push(turn);
	}

	// Add debate transcript
	content += "## Debate Transcript\n\n";
	const sortedRounds = Array.from(turnsByRound.keys()).sort((a, b) => a - b);

	for (const roundNum of sortedRounds) {
		const turns = turnsByRound.get(roundNum) || [];
		content += `### Round ${roundNum}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			content += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				content += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}
	}

	// Add judge verdicts
	if (judgeNotes.length > 0) {
		content += "## Judge Verdicts\n\n";
		for (const note of judgeNotes) {
			content += `**Round ${note.roundNumber}** (Leading: ${note.leading}):\n\n`;
			content += `${note.reasoning}\n\n`;
		}
	}

	return content;
}

function buildTruncatedPrompt(
	state: DebateState,
	judgeNotes: JudgeNote[],
	instructions: string,
	config: SynthesisPromptConfig,
	roundSummaries?: string[],
): string {
	// Group turns by round
	const turnsByRound = new Map<number, typeof state.turns>();
	for (const turn of state.turns) {
		if (!turnsByRound.has(turn.roundNumber)) {
			turnsByRound.set(turn.roundNumber, []);
		}
		turnsByRound.get(turn.roundNumber)?.push(turn);
	}

	const sortedRounds = Array.from(turnsByRound.keys()).sort((a, b) => a - b);

	// Always include last 2 rounds
	const lastTwoRounds = sortedRounds.slice(-2);
	const thirdToLastRound =
		sortedRounds.length >= 3 ? sortedRounds[sortedRounds.length - 3] : null;

	// Build fixed components (always included)
	let fixedContent = instructions;
	fixedContent += "\n\n";
	fixedContent += `## Topic\n\n${state.config.topic}\n\n`;

	// Add round summaries if provided
	if (roundSummaries && roundSummaries.length > 0) {
		fixedContent += "## Round Summaries\n\n";
		for (const summary of roundSummaries) {
			fixedContent += `${summary}\n\n`;
		}
	}

	// Add last 2 rounds
	fixedContent += "## Debate Transcript (Last 2 Rounds)\n\n";
	for (const roundNum of lastTwoRounds) {
		const turns = turnsByRound.get(roundNum) || [];
		fixedContent += `### Round ${roundNum}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			fixedContent += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				fixedContent += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}
	}

	// Add judge verdicts (always include all)
	if (judgeNotes.length > 0) {
		fixedContent += "## Judge Verdicts\n\n";
		for (const note of judgeNotes) {
			fixedContent += `**Round ${note.roundNumber}** (Leading: ${note.leading}):\n\n`;
			fixedContent += `${note.reasoning}\n\n`;
		}
	}

	const fixedTokens = estimateTokens(fixedContent);
	const tokenBudget = config.contextTokenLimit * 0.6;
	const remainingBudget = tokenBudget - fixedTokens;

	// Try to add 3rd-to-last round if it fits
	if (thirdToLastRound !== null && remainingBudget > 0) {
		const turns = turnsByRound.get(thirdToLastRound) || [];
		let thirdRoundContent = `### Round ${thirdToLastRound}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			thirdRoundContent += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				thirdRoundContent += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}

		const thirdRoundTokens = estimateTokens(thirdRoundContent);
		if (thirdRoundTokens <= remainingBudget) {
			// Insert before last 2 rounds
			const transcriptStart = fixedContent.indexOf(
				"## Debate Transcript (Last 2 Rounds)",
			);
			const lastRoundsStart = fixedContent.indexOf(
				"### Round",
				transcriptStart,
			);
			fixedContent =
				fixedContent.slice(0, lastRoundsStart) +
				thirdRoundContent +
				fixedContent.slice(lastRoundsStart);
		}
	}

	// Add note about truncation for earlier rounds
	if (sortedRounds.length > 3) {
		const truncatedCount = sortedRounds.length - 3;
		const noteText = detectCjkMajority(state.config.topic)
			? `\n*注意：为节省上下文空间，省略了前 ${truncatedCount} 轮的详细内容。*\n\n`
			: `\n*Note: ${truncatedCount} earlier rounds omitted for brevity. Focus on the most recent rounds and judge verdicts above.*\n\n`;

		const transcriptStart = fixedContent.indexOf("## Debate Transcript");
		const headerEnd = fixedContent.indexOf("\n\n", transcriptStart) + 2;
		fixedContent =
			fixedContent.slice(0, headerEnd) +
			noteText +
			fixedContent.slice(headerEnd);
	}

	return fixedContent;
}
