// packages/orchestrator-core/src/context-builder.ts
import type { TurnRecord } from "@crossfire/adapter-core";
import { filterUnresolved } from "./debate-memory.js";
import type { DebateRole, DebateState, DebateTurn } from "./types.js";

export interface TurnPromptOptions {
	guidance?: string;
	userInjection?: { text: string; priority: "normal" | "high" };
	shouldTryToConclude?: boolean;
	repetitionWarnings?: string[];
}

/** Simple end truncation */
export function truncate(text: string, maxChars: number): string {
	return text.length > maxChars ? text.slice(0, maxChars) + "..." : text;
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
	if (maxChars <= marker.length) return text.slice(0, maxChars) + "...";
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

// ---------------------------------------------------------------------------
// PromptContext (turn prompt data)
// ---------------------------------------------------------------------------

export interface PromptContext {
	topic: string;
	languageHint: string;
	roundNumber: number;
	maxRounds: number;
	role: "proposer" | "challenger";

	longMemory: {
		selfStance?: string;
		selfConfidence?: number;
		opponentStance?: string;
		opponentConfidence?: number;
		selfKeyPoints: string[];
		opponentKeyPoints: string[];
		selfConcessions: string[];
		opponentConcessions: string[];
		unresolvedIssues: string[];
		judgeSummary?: string;
		directorGuidance?: string[];
		userInjection?: { text: string; priority: "normal" | "high" };
	};

	localWindow: {
		opponentLastTurnFull?: string;
		selfLastTurnSummary?: string;
	};

	controls: {
		shouldTryToConclude: boolean;
		repetitionWarnings?: string[];
	};
}

// ---------------------------------------------------------------------------
// JudgePromptContext
// ---------------------------------------------------------------------------

export interface JudgePromptContext {
	topic: string;
	languageHint: string;
	roundNumber: number;
	maxRounds: number;
	proposerStance?: string;
	proposerConfidence?: number;
	challengerStance?: string;
	challengerConfidence?: number;
	proposerKeyPoints: string[];
	challengerKeyPoints: string[];
	proposerConcessions: string[];
	challengerConcessions: string[];
	unresolvedIssues: string[];
	previousJudgeSummary?: string;
	proposerLastTurn?: string;
	challengerLastTurn?: string;
	earlyEndGuidance: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectItems(
	turns: DebateTurn[],
	field: "keyPoints" | "concessions",
	limit: number,
	charLimit: number,
): string[] {
	const all: string[] = [];
	for (const t of turns) {
		const items = t.meta?.[field] ?? [];
		for (const item of items) {
			all.push(item);
		}
	}
	// Dedupe keeping last occurrence (later rounds priority)
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (let i = all.length - 1; i >= 0; i--) {
		if (!seen.has(all[i])) {
			seen.add(all[i]);
			deduped.unshift(all[i]);
		}
	}
	// Keep most recent items if over limit
	return deduped.slice(-limit).map((item) => truncate(item, charLimit));
}

function renderBullets(items: string[], indent = "- "): string {
	return items.length > 0
		? items.map((i) => `${indent}${i}`).join("\n")
		: "(none)";
}

// ---------------------------------------------------------------------------
// buildPromptContext — extract structured data for turn prompts
// ---------------------------------------------------------------------------

export function buildPromptContext(
	state: DebateState,
	role: DebateRole,
	options?: {
		guidance?: string[];
		userInjection?: { text: string; priority: "normal" | "high" };
		shouldTryToConclude?: boolean;
		repetitionWarnings?: string[];
		maxOpponentChars?: number;
	},
): PromptContext {
	const opponentRole: DebateRole =
		role === "proposer" ? "challenger" : "proposer";

	const ownTurns = state.turns.filter((t) => t.role === role);
	const opponentTurns = state.turns.filter((t) => t.role === opponentRole);

	const latestOwn =
		ownTurns.length > 0 ? ownTurns[ownTurns.length - 1] : undefined;
	const latestOpponent =
		opponentTurns.length > 0
			? opponentTurns[opponentTurns.length - 1]
			: undefined;

	// Unresolved issues: latest round keyPoints vs all concessions
	const latestRound =
		state.currentRound > 1 ? state.currentRound - 1 : state.currentRound;
	const latestRoundTurns = state.turns.filter(
		(t) => t.roundNumber === latestRound,
	);
	const latestRoundPoints: string[] = [];
	for (const t of latestRoundTurns) {
		for (const p of t.meta?.keyPoints ?? []) {
			latestRoundPoints.push(p);
		}
	}
	const allConcessions: string[] = [];
	for (const t of state.turns) {
		for (const c of t.meta?.concessions ?? []) {
			allConcessions.push(c);
		}
	}
	const unresolvedIssues = filterUnresolved(latestRoundPoints, allConcessions)
		.slice(0, 10)
		.map((p) => truncate(p, 160));

	// Judge summary: iterate backwards to find last judgeVerdict
	let judgeSummary: string | undefined;
	for (let i = state.turns.length - 1; i >= 0; i--) {
		const verdict = state.turns[i].judgeVerdict;
		if (verdict?.reasoning) {
			judgeSummary = truncate(verdict.reasoning, 300);
			break;
		}
	}

	// Local window
	let opponentLastTurnFull: string | undefined;
	if (latestOpponent) {
		opponentLastTurnFull = truncateWithHeadTail(
			normalizeWhitespace(latestOpponent.content),
			options?.maxOpponentChars ?? 1500,
		);
	}

	let selfLastTurnSummary: string | undefined;
	if (latestOwn) {
		const kp = latestOwn.meta?.keyPoints;
		if (kp && kp.length > 0) {
			selfLastTurnSummary = truncate(kp.join("; "), 500);
		} else {
			selfLastTurnSummary = truncate(latestOwn.content, 300);
		}
	}

	return {
		topic: state.config.topic,
		languageHint: detectLanguageHint(state.config.topic),
		roundNumber: state.currentRound,
		maxRounds: state.config.maxRounds,
		role,

		longMemory: {
			selfStance: latestOwn?.meta?.stance,
			selfConfidence: latestOwn?.meta?.confidence,
			opponentStance: latestOpponent?.meta?.stance,
			opponentConfidence: latestOpponent?.meta?.confidence,
			selfKeyPoints: collectItems(ownTurns, "keyPoints", 12, 160),
			opponentKeyPoints: collectItems(opponentTurns, "keyPoints", 12, 160),
			selfConcessions: collectItems(ownTurns, "concessions", 8, 160),
			opponentConcessions: collectItems(opponentTurns, "concessions", 8, 160),
			unresolvedIssues,
			judgeSummary,
			directorGuidance: options?.guidance?.slice(0, 3),
			userInjection: options?.userInjection,
		},

		localWindow: {
			opponentLastTurnFull,
			selfLastTurnSummary,
		},

		controls: {
			shouldTryToConclude: options?.shouldTryToConclude ?? false,
			repetitionWarnings: options?.repetitionWarnings,
		},
	};
}

// ---------------------------------------------------------------------------
// buildJudgePromptContext — extract structured data for judge prompts
// ---------------------------------------------------------------------------

export function buildJudgePromptContext(
	state: DebateState,
	options?: { maxTurnChars?: number },
): JudgePromptContext {
	const maxChars = options?.maxTurnChars ?? 1500;
	const proposerTurns = state.turns.filter((t) => t.role === "proposer");
	const challengerTurns = state.turns.filter((t) => t.role === "challenger");
	const latestProposer =
		proposerTurns.length > 0
			? proposerTurns[proposerTurns.length - 1]
			: undefined;
	const latestChallenger =
		challengerTurns.length > 0
			? challengerTurns[challengerTurns.length - 1]
			: undefined;

	const allConcessions = state.turns.flatMap((t) => t.meta?.concessions ?? []);
	const latestRoundPoints = state.turns
		.filter(
			(t) =>
				t.roundNumber ===
				(state.currentRound > 1 ? state.currentRound - 1 : state.currentRound),
		)
		.flatMap((t) => t.meta?.keyPoints ?? []);

	let previousJudgeSummary: string | undefined;
	for (let i = state.turns.length - 1; i >= 0; i--) {
		if (state.turns[i].judgeVerdict?.reasoning) {
			previousJudgeSummary = truncate(
				state.turns[i].judgeVerdict!.reasoning,
				300,
			);
			break;
		}
	}

	const remaining = state.config.maxRounds - state.currentRound;
	const earlyEndGuidance =
		remaining > 0
			? `There are ${remaining} rounds remaining out of ${state.config.maxRounds}. Set should_continue to false ONLY if the proposal has been sufficiently stress-tested for a comprehensive action plan, or further rounds are unlikely to surface new insight.`
			: "This is the final evaluation.";

	return {
		topic: state.config.topic,
		languageHint: detectLanguageHint(state.config.topic),
		roundNumber: state.currentRound,
		maxRounds: state.config.maxRounds,
		proposerStance: latestProposer?.meta?.stance,
		proposerConfidence: latestProposer?.meta?.confidence,
		challengerStance: latestChallenger?.meta?.stance,
		challengerConfidence: latestChallenger?.meta?.confidence,
		proposerKeyPoints: collectItems(proposerTurns, "keyPoints", 12, 160),
		challengerKeyPoints: collectItems(challengerTurns, "keyPoints", 12, 160),
		proposerConcessions: collectItems(proposerTurns, "concessions", 8, 160),
		challengerConcessions: collectItems(challengerTurns, "concessions", 8, 160),
		unresolvedIssues: filterUnresolved(latestRoundPoints, allConcessions)
			.slice(0, 10)
			.map((p) => truncate(p, 160)),
		previousJudgeSummary,
		proposerLastTurn: latestProposer
			? truncateWithHeadTail(
					normalizeWhitespace(latestProposer.content),
					maxChars,
				)
			: undefined,
		challengerLastTurn: latestChallenger
			? truncateWithHeadTail(
					normalizeWhitespace(latestChallenger.content),
					maxChars,
				)
			: undefined,
		earlyEndGuidance,
	};
}

// ---------------------------------------------------------------------------
// renderTurnPrompt — 4-layer template renderer
// ---------------------------------------------------------------------------

function renderTurnPrompt(ctx: PromptContext): string {
	const sections: string[] = [];
	const isProposer = ctx.role === "proposer";
	const defaultLang =
		"You MUST respond in the same language as the debate topic.";

	// --- Layer 1: Stable identity ---

	sections.push(`[TOPIC]\n${ctx.topic}`);

	sections.push(
		`[PURPOSE]\nThis is a structured review process. The goal is NOT to win an argument — it is to produce the most thorough, actionable plan possible through adversarial collaboration. Every round should deepen insight, surface hidden risks, and sharpen recommendations.`,
	);

	if (isProposer) {
		sections.push(
			`[ROLE]\nYou are the proposer. You develop and refine the proposal, incorporating valid challenges to make it stronger and more complete.\nThis is round ${ctx.roundNumber} of ${ctx.maxRounds}.`,
		);
	} else {
		sections.push(
			`[ROLE]\nYou are the challenger. You stress-test the proposal by probing assumptions, surfacing risks, and examining blind spots — not to tear it down, but to force it to become robust.\nThis is round ${ctx.roundNumber} of ${ctx.maxRounds}.`,
		);
	}

	if (isProposer) {
		sections.push(
			`[ENGAGEMENT PRINCIPLES]\n- Develop your position with evidence and reasoning.\n- Directly engage with the challenger's strongest concerns.\n- Refine and strengthen your proposal each round — show how challenges improved it.\n- Make genuine concessions when the challenger surfaces valid risks.\n- Do not repeat points already made — advance the analysis.`,
		);
	} else {
		sections.push(
			`[ENGAGEMENT PRINCIPLES]\n- Probe the proposal's strongest claims, not the weakest.\n- Provide specific, concrete analysis — avoid vague objections.\n- Acknowledge where the proposal is sound (selective agreement sharpens focus).\n- Introduce new angles, edge cases, and unexplored implications.\n- Do not repeat points already made — advance the analysis.`,
		);
	}

	if (ctx.languageHint !== defaultLang) {
		sections.push(`[LANGUAGE]\n${ctx.languageHint}`);
	}

	// --- Layer 2: Long-term memory ---

	const mem = ctx.longMemory;
	const memLines: string[] = [];
	memLines.push(
		`- Your current stance: ${mem.selfStance ?? "not yet stated"} (confidence: ${mem.selfConfidence ?? "N/A"})`,
	);
	memLines.push(
		`- Counterpart stance: ${mem.opponentStance ?? "not yet stated"} (confidence: ${mem.opponentConfidence ?? "N/A"})`,
	);
	memLines.push(
		`- Your key points so far:\n${renderBullets(mem.selfKeyPoints, "  - ")}`,
	);
	memLines.push(
		`- Counterpart key points so far:\n${renderBullets(mem.opponentKeyPoints, "  - ")}`,
	);
	memLines.push(
		`- Your concessions so far:\n${renderBullets(mem.selfConcessions, "  - ")}`,
	);
	memLines.push(
		`- Counterpart concessions so far:\n${renderBullets(mem.opponentConcessions, "  - ")}`,
	);
	memLines.push(
		`- Unresolved issues:\n${renderBullets(mem.unresolvedIssues, "  - ")}`,
	);
	if (mem.judgeSummary) {
		memLines.push(`- Previous judge summary: ${mem.judgeSummary}`);
	}
	sections.push(`[REVIEW PROGRESS]\n${memLines.join("\n")}`);

	if (mem.directorGuidance && mem.directorGuidance.length > 0) {
		sections.push(
			`[DIRECTOR GUIDANCE]\n${mem.directorGuidance.map((g) => `- ${g}`).join("\n")}`,
		);
	}

	if (mem.userInjection && mem.userInjection.priority === "normal") {
		sections.push(
			`[USER GUIDANCE]\nThe human operator has provided the following guidance:\n${mem.userInjection.text}`,
		);
	}

	// --- Layer 3: Local working context ---

	const localLines: string[] = [];
	if (ctx.localWindow.opponentLastTurnFull) {
		localLines.push(
			`Counterpart's latest response:\n${ctx.localWindow.opponentLastTurnFull}`,
		);
	}
	if (ctx.localWindow.selfLastTurnSummary) {
		localLines.push(
			`Your last turn summary: ${ctx.localWindow.selfLastTurnSummary}`,
		);
	}
	if (localLines.length > 0) {
		sections.push(`[LOCAL WORKING CONTEXT]\n${localLines.join("\n\n")}`);
	}

	// Repetition warnings
	if (
		ctx.controls.repetitionWarnings &&
		ctx.controls.repetitionWarnings.length > 0
	) {
		sections.push(
			`[REPETITION WARNING]\nYou are repeating yourself. Avoid the following points which have already been made:\n${ctx.controls.repetitionWarnings.map((w) => `- ${w}`).join("\n")}`,
		);
	}

	// --- High-priority injection (between layer 3 and 4) ---

	if (mem.userInjection && mem.userInjection.priority === "high") {
		sections.push(
			`[HIGH PRIORITY USER DIRECTIVE]\nThe human operator requires you to address the following IMMEDIATELY:\n${mem.userInjection.text}`,
		);
	}

	// --- Layer 4: Action / objective ---

	if (isProposer) {
		sections.push(
			`[THIS TURN'S OBJECTIVE]\nStrengthen the proposal by:\n1. Address the challenger's 2 most substantive concerns — show how the plan adapts.\n2. Clarify and refine your proposal with specifics.\n3. Advance at least 1 new dimension that makes the action plan more complete.`,
		);
	} else {
		sections.push(
			`[THIS TURN'S OBJECTIVE]\nDeepen the analysis by:\n1. Identify the 2 most critical gaps or risks in the current proposal.\n2. Show where reasoning needs more evidence or where edge cases are unaddressed.\n3. Acknowledge where the proposal has genuinely improved — focus your energy on what still matters.`,
		);
	}

	if (ctx.controls.shouldTryToConclude) {
		sections.push(
			`[CONCLUSION MODE]\nThe review is approaching convergence. Consolidate your final position clearly. Set wants_to_conclude to true in your debate_meta output if you believe the remaining gaps are minor enough that the action plan is ready.`,
		);
	} else {
		sections.push(
			`[CONTINUE MODE]\nContinue engaging substantively. Set wants_to_conclude to false unless you genuinely believe the proposal has been stress-tested enough for a strong action plan.`,
		);
	}

	sections.push(
		`[OUTPUT INSTRUCTIONS]\nAfter your argument, you MUST output a fenced JSON block labeled debate_meta with your structured summary.\nExample format (use EXACTLY this structure):\n\`\`\`debate_meta\n{"stance":"agree","confidence":0.75,"key_points":["point 1","point 2"],"concessions":["concession 1"],"wants_to_conclude":false,"rebuttals":[{"target":"opponent's claim X","response":"because Y"}],"evidence":[{"claim":"X is true","source":"data/benchmark"}],"risk_flags":[{"risk":"scalability issue","severity":"medium"}],"position_shifts":[{"from":"strongly agree","to":"agree","reason":"valid counterpoint on X"}]}\n\`\`\`\nField rules:\n- stance: one of "strongly_agree", "agree", "neutral", "disagree", "strongly_disagree"\n- confidence: number 0.0 to 1.0\n- key_points: array of 2-4 main arguments this turn\n- concessions: array of points you concede (can be empty [])\n- wants_to_conclude: boolean\n- rebuttals: (optional) array of {target, response} — which opponent arguments you rebutted and how\n- evidence: (optional) array of {claim, source} — specific data, benchmarks, or references you cited\n- risk_flags: (optional) array of {risk, severity} — risks you identified (severity: "low"/"medium"/"high")\n- position_shifts: (optional) array of {from, to, reason} — how your position changed this round and why\nIMPORTANT: Output valid JSON inside the fenced block. Do NOT use markdown bullet points. Optional fields can be omitted if not applicable.`,
	);

	return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// renderJudgePrompt — structured judge template
// ---------------------------------------------------------------------------

function renderJudgePrompt(ctx: JudgePromptContext): string {
	const sections: string[] = [];

	sections.push(`[TOPIC]\n${ctx.topic}`);

	sections.push(
		`[JUDGE TASK]\nYou are the judge assessing this structured review after round ${ctx.roundNumber} of ${ctx.maxRounds}.\nYour goal: determine whether the exchange is producing a strong, actionable plan. Evaluate which side is contributing more to the plan's depth, completeness, and practical viability — not who is "winning" rhetorically.\nBe concise and direct. Do NOT narrate your process. Go straight to your assessment, then give your verdict via the judge_verdict tool.`,
	);

	sections.push(
		`[LANGUAGE]\n${ctx.languageHint}\nYour reasoning, verdict text, and all output MUST be in the same language as the debate topic. Do NOT mix languages.`,
	);

	// Structured summary
	const summaryLines: string[] = [];
	summaryLines.push(
		`Proposer stance: ${ctx.proposerStance ?? "not stated"} (confidence: ${ctx.proposerConfidence ?? "N/A"})`,
	);
	summaryLines.push(
		`Challenger stance: ${ctx.challengerStance ?? "not stated"} (confidence: ${ctx.challengerConfidence ?? "N/A"})`,
	);
	summaryLines.push(
		`\nProposer key points:\n${renderBullets(ctx.proposerKeyPoints)}`,
	);
	summaryLines.push(
		`Challenger key points:\n${renderBullets(ctx.challengerKeyPoints)}`,
	);
	summaryLines.push(
		`\nProposer concessions:\n${renderBullets(ctx.proposerConcessions)}`,
	);
	summaryLines.push(
		`Challenger concessions:\n${renderBullets(ctx.challengerConcessions)}`,
	);
	summaryLines.push(
		`\nUnresolved issues:\n${renderBullets(ctx.unresolvedIssues)}`,
	);
	if (ctx.previousJudgeSummary) {
		summaryLines.push(
			`\nPrevious judge assessment: ${ctx.previousJudgeSummary}`,
		);
	}
	sections.push(`[REVIEW SUMMARY]\n${summaryLines.join("\n")}`);

	// Recent round content
	const recentLines: string[] = [];
	if (ctx.proposerLastTurn) {
		recentLines.push(`Proposer (latest):\n${ctx.proposerLastTurn}`);
	}
	if (ctx.challengerLastTurn) {
		recentLines.push(`Challenger (latest):\n${ctx.challengerLastTurn}`);
	}
	if (recentLines.length > 0) {
		sections.push(`[RECENT ROUND CONTENT]\n${recentLines.join("\n\n")}`);
	}

	sections.push(
		`[ASSESSMENT CRITERIA]\nEvaluate the review so far. Consider:\n- Quality and specificity of reasoning (not rhetorical skill)\n- Whether challenges are forcing genuine improvement to the proposal\n- Whether the proposer is incorporating feedback substantively (not just deflecting)\n- How much closer the exchange is to a complete, actionable plan\n- Remaining blind spots, risks, or gaps that need more rounds to address\n${ctx.earlyEndGuidance}`,
	);

	sections.push(
		`[OUTPUT INSTRUCTIONS]\nYou MUST output a fenced JSON block labeled judge_verdict with your evaluation.\nExample format (use EXACTLY this structure):\n\`\`\`judge_verdict\n{"leading":"challenger","score":{"proposer":6,"challenger":7},"reasoning":"Brief analysis here.","should_continue":true}\n\`\`\`\nField rules:\n- leading: who is contributing more to the action plan's quality — "proposer", "challenger", or "tie"\n- score: { "proposer": 0-10, "challenger": 0-10 } — contribution to plan quality, not rhetorical performance\n- reasoning: your analysis (2-4 sentences, same language as topic)\n- should_continue: boolean — is the plan ready, or would more rounds produce meaningful improvement?\nIMPORTANT: Output valid JSON inside the fenced block. Do NOT use markdown formatting or bullet points for the verdict.`,
	);

	return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Public API: buildTurnPromptFromState (new pipeline)
// ---------------------------------------------------------------------------

export function buildTurnPromptFromState(
	state: DebateState,
	role: DebateRole,
	options?: TurnPromptOptions,
): string {
	const ctx = buildPromptContext(state, role, {
		guidance: options?.guidance ? [options.guidance] : undefined,
		userInjection: options?.userInjection,
		shouldTryToConclude: options?.shouldTryToConclude,
		repetitionWarnings: options?.repetitionWarnings,
	});
	return renderTurnPrompt(ctx);
}

// ---------------------------------------------------------------------------
// Public API: backward-compatible wrappers
// ---------------------------------------------------------------------------

export function buildTurnPrompt(
	state: DebateState,
	role: DebateRole,
	options?: TurnPromptOptions,
): string {
	return buildTurnPromptFromState(state, role, options);
}

export function buildJudgePrompt(state: DebateState): string {
	return renderJudgePrompt(buildJudgePromptContext(state));
}

// ===========================================================================
// Incremental Prompt Builder — new functions (coexist with old 4-layer code)
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
