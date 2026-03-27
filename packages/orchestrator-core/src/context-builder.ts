// packages/orchestrator-core/src/context-builder.ts
import type { TurnRecord } from "@crossfire/adapter-core";

/** Simple end truncation */
export function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

/** Collapse excessive whitespace */
export function normalizeWhitespace(text: string): string {
	return text
		.replace(/\n{3,}/g, "\n\n")
		.replace(/ {2,}/g, " ")
		.trim();
}

/** Head 60% + tail 40% truncation with marker */
export function truncateWithHeadTail(
	text: string,
	maxChars: number,
	headRatio = 0.6,
): string {
	if (text.length <= maxChars) return text;
	const marker = "\n[...truncated...]\n";
	if (maxChars <= marker.length) return `${text.slice(0, maxChars)}...`;
	const headLen = Math.floor((maxChars - marker.length) * headRatio);
	const tailLen = maxChars - marker.length - headLen;
	return text.slice(0, headLen) + marker + text.slice(-tailLen);
}

/** Detect if text is predominantly CJK (Chinese/Japanese/Korean) */
function detectLanguageHint(text: string): string {
	const cjk = text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g);
	if (cjk && cjk.length > text.length * 0.1) {
		return "You MUST respond in the same language as the debate topic (Chinese). All arguments, analysis, and explanations must be in Chinese.";
	}
	return "You MUST respond in the same language as the debate topic.";
}

// ===========================================================================
// Incremental Prompt Builder
// ===========================================================================

// --- Role-specific default system prompts ---

export function defaultSystemPrompt(
	role: "proposer" | "challenger" | "judge",
): string {
	switch (role) {
		case "proposer":
			return [
				"You are the proposer in a structured adversarial review.",
				"Your role is to develop and refine the proposal, building a comprehensive action plan.",
				"Engage constructively: strengthen your reasoning when challenged, acknowledge valid criticisms,",
				"and identify blind spots in the other side's reasoning rather than trying to 'win' the debate.",
				"Focus on producing actionable insight, not rhetorical dominance.",
			].join(" ");
		case "challenger":
			return [
				"You are the challenger in a structured adversarial review.",
				"Your role is to stress-test the proposal by probing assumptions, identifying risks,",
				"and surfacing blind spots that could undermine the action plan.",
				"Engage constructively: acknowledge genuine strengths, offer concrete alternatives,",
				"and identify blind spots in the other side's reasoning rather than trying to 'win' the debate.",
				"Focus on making the final plan more robust, not on defeating the proposer.",
			].join(" ");
		case "judge":
			return [
				"You are the judge assessing a structured adversarial review.",
				"Evaluate which side contributes more to producing a comprehensive, actionable plan.",
				"Focus on reasoning quality, evidence depth, blind spot identification, and plan completeness.",
				"Do not pick a 'winner' — assess which arguments most improve the final deliverable.",
			].join(" ");
	}
}

// --- Schema template constants (module-level, NOT exported) ---

const DEBATE_META_SCHEMA_FULL = `Output a \`debate_meta\` JSON block at the end of your response with these fields:
\`\`\`
{
  "stance": "strongly_agree" | "agree" | "neutral" | "disagree" | "strongly_disagree",
  "confidence": 0.0-1.0,
  "key_points": ["point1", "point2", ...],
  "concessions": ["concession1", ...],
  "wants_to_conclude": true | false,
  "rebuttals": [{"target": "...", "response": "..."}],
  "evidence": [{"claim": "...", "source": "..."}],
  "risk_flags": [{"risk": "...", "severity": "low"|"medium"|"high"}],
  "position_shifts": [{"from": "...", "to": "...", "reason": "..."}]
}
\`\`\`
Required fields: stance, confidence, key_points. Others optional but encouraged.`;

const DEBATE_META_REMINDER =
	"(Remember to include your debate_meta JSON block at the end of your response.)";

const JUDGE_VERDICT_SCHEMA_FULL = `Output a \`judge_verdict\` JSON block with these fields:
\`\`\`
{
  "leading": "proposer" | "challenger" | "tie",
  "score": { "proposer": 0-10, "challenger": 0-10 },
  "reasoning": "your assessment",
  "should_continue": true | false
}
\`\`\`
All fields required.`;

const JUDGE_VERDICT_REMINDER = "(Please output your judge_verdict JSON block.)";

// --- Incremental prompt input interfaces ---

export interface InitialPromptInput {
	role: "proposer" | "challenger";
	topic: string;
	maxRounds: number;
	systemPrompt: string | undefined;
	schemaType: "debate_meta" | "judge_verdict";
	operationalPreamble?: string;
}

export function buildInitialPrompt(input: InitialPromptInput): string {
	const identity = input.systemPrompt || defaultSystemPrompt(input.role);
	const languageHint = detectLanguageHint(input.topic);
	const parts: string[] = [
		`[SYSTEM PROMPT]\n${identity}`,
		`[TOPIC]\n${input.topic}`,
		`[ROUND INFO]\nThis is round 1 of ${input.maxRounds}. You are the ${input.role}.`,
	];
	if (languageHint) parts.push(`[LANGUAGE]\n${languageHint}`);
	if (input.operationalPreamble) parts.push(input.operationalPreamble);
	const schema =
		input.schemaType === "judge_verdict"
			? JUDGE_VERDICT_SCHEMA_FULL
			: DEBATE_META_SCHEMA_FULL;
	parts.push(`[OUTPUT FORMAT]\n${schema}`);
	return parts.join("\n\n");
}

export interface IncrementalPromptInput {
	roundNumber: number;
	maxRounds: number;
	opponentRole: "proposer" | "challenger";
	opponentText: string;
	judgeText?: string;
	schemaRefreshMode: "full" | "reminder";
}

export function buildIncrementalPrompt(input: IncrementalPromptInput): string {
	const parts: string[] = [];
	if (input.judgeText) {
		parts.push(`Round ${input.roundNumber}/${input.maxRounds}.`);
		parts.push(
			`Judge assessment after round ${input.roundNumber - 1}:\n\n${input.judgeText}`,
		);
		parts.push(`${input.opponentRole}'s response:\n\n${input.opponentText}`);
	} else {
		parts.push(
			`Round ${input.roundNumber}/${input.maxRounds}, ${input.opponentRole}'s response:`,
		);
		parts.push(input.opponentText);
	}
	if (input.schemaRefreshMode === "full") {
		parts.push(DEBATE_META_SCHEMA_FULL);
	} else {
		parts.push(DEBATE_META_REMINDER);
	}
	return parts.join("\n\n");
}

export interface JudgeInitialPromptInput {
	topic: string;
	maxRounds: number;
	roundNumber: number;
	proposerText: string;
	challengerText: string;
	systemPrompt: string | undefined;
}

export function buildJudgeInitialPrompt(
	input: JudgeInitialPromptInput,
): string {
	const identity = input.systemPrompt || defaultSystemPrompt("judge");
	const languageHint = detectLanguageHint(input.topic);
	const parts: string[] = [
		`[SYSTEM PROMPT]\n${identity}`,
		`[TOPIC]\n${input.topic}`,
		`[ROUND INFO]\nJudging round ${input.roundNumber} of ${input.maxRounds}.`,
	];
	if (languageHint) parts.push(`[LANGUAGE]\n${languageHint}`);
	parts.push(`Proposer's response:\n\n${input.proposerText}`);
	parts.push(`Challenger's response:\n\n${input.challengerText}`);
	parts.push(`[OUTPUT FORMAT]\n${JUDGE_VERDICT_SCHEMA_FULL}`);
	return parts.join("\n\n");
}

export interface JudgeIncrementalPromptInput {
	roundNumber: number;
	maxRounds: number;
	proposerText: string;
	challengerText: string;
	schemaRefreshMode: "full" | "reminder";
}

export function buildJudgeIncrementalPrompt(
	input: JudgeIncrementalPromptInput,
): string {
	const parts: string[] = [
		`Judging round ${input.roundNumber} of ${input.maxRounds}.`,
		`Proposer's response:\n\n${input.proposerText}`,
		`Challenger's response:\n\n${input.challengerText}`,
	];
	if (input.schemaRefreshMode === "full") {
		parts.push(JUDGE_VERDICT_SCHEMA_FULL);
	} else {
		parts.push(JUDGE_VERDICT_REMINDER);
	}
	return parts.join("\n\n");
}

// --- Transcript recovery prompt ---

export interface TranscriptRecoveryInput {
	systemPrompt: string;
	topic: string;
	transcript: TurnRecord[];
	schemaType: "debate_meta" | "judge_verdict";
	operationalPreamble?: string;
	recoveryBudgetChars?: number;
}

const DEFAULT_RECOVERY_BUDGET_CHARS = 200_000;
const RECENT_TURNS_TO_KEEP_FULL = 4;

export function buildTranscriptRecoveryPrompt(
	input: TranscriptRecoveryInput,
): string {
	const budget = input.recoveryBudgetChars ?? DEFAULT_RECOVERY_BUDGET_CHARS;
	const schema =
		input.schemaType === "judge_verdict"
			? JUDGE_VERDICT_SCHEMA_FULL
			: DEBATE_META_SCHEMA_FULL;

	const header = [
		`[SYSTEM PROMPT]\n${input.systemPrompt}`,
		`[TOPIC]\n${input.topic}`,
		input.operationalPreamble ?? "",
		`[OUTPUT FORMAT]\n${schema}`,
	]
		.filter(Boolean)
		.join("\n\n");

	// Early return for empty transcript
	if (input.transcript.length === 0) return header;

	// Try full rebuild first
	const fullTurns = input.transcript
		.map((t) => `Round ${t.roundNumber}, ${t.role}'s response:\n\n${t.content}`)
		.join("\n\n---\n\n");

	const fullPrompt = `${header}\n\n${fullTurns}`;
	if (fullPrompt.length <= budget) return fullPrompt;

	// Budgeted rebuild — determine how many recent turns we can keep in full
	const headerBudget = header.length + 200; // header + separators
	let recentCount = Math.min(
		RECENT_TURNS_TO_KEEP_FULL,
		input.transcript.length,
	);
	// Shrink recent window if the recent turns alone would exceed budget
	while (recentCount > 1) {
		const candidateRecent = input.transcript.slice(-recentCount);
		const recentChars = candidateRecent.reduce(
			(sum, t) => sum + t.content.length + 100,
			0,
		);
		if (recentChars + headerBudget < budget) break;
		recentCount--;
	}
	const olderTurns = input.transcript.slice(0, -recentCount);
	const recentTurns = input.transcript.slice(-recentCount);

	const olderSummaries = olderTurns
		.map((t) => {
			if (t.meta) {
				const points = t.meta.keyPoints?.join("; ") ?? "";
				const concessions = t.meta.concessions?.join("; ") ?? "";
				return `Round ${t.roundNumber}, ${t.role} (summary): stance=${t.meta.stance}, confidence=${t.meta.confidence}, key_points=[${points}]${concessions ? `, concessions=[${concessions}]` : ""}`;
			}
			const preview = t.content.slice(0, 300);
			return `Round ${t.roundNumber}, ${t.role} (summary): ${preview}... [Turn truncated for recovery - original was ${t.content.length} chars]`;
		})
		.join("\n");

	// Calculate remaining budget for recent turns after header + summaries
	const summaryOverhead = headerBudget + olderSummaries.length + 100;
	const recentBudget = Math.max(budget - summaryOverhead, 2000);
	const perTurnBudget = Math.floor(recentBudget / recentCount);

	const recentFull = recentTurns
		.map((t) => {
			const content =
				t.content.length > perTurnBudget
					? truncateWithHeadTail(t.content, perTurnBudget)
					: t.content;
			return `Round ${t.roundNumber}, ${t.role}'s response:\n\n${content}`;
		})
		.join("\n\n---\n\n");

	const firstOlderRound =
		olderTurns.length > 0 ? olderTurns[0].roundNumber : "?";
	const lastOlderRound =
		olderTurns.length > 0 ? olderTurns[olderTurns.length - 1].roundNumber : "?";

	return [
		header,
		`[CONTEXT RECOVERED - turns from round ${firstOlderRound} to ${lastOlderRound} are summarized]\n\n${olderSummaries}`,
		recentFull,
	].join("\n\n---\n\n");
}
