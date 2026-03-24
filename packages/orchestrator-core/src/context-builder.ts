// packages/orchestrator-core/src/context-builder.ts
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
      ? `There are ${remaining} rounds remaining out of ${state.config.maxRounds}. Set should_continue to false ONLY if the debate has truly exhausted all substantive disagreement.`
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

  if (isProposer) {
    sections.push(
      `[ROLE]\nYou are the proposer. Your job is to defend the proposition, refine your thesis in response to challenges, and make concessions where warranted.\nThis is round ${ctx.roundNumber} of ${ctx.maxRounds}.`,
    );
  } else {
    sections.push(
      `[ROLE]\nYou are the challenger. Your job is to identify weaknesses, hidden assumptions, and logical gaps in the proposer's argument.\nThis is round ${ctx.roundNumber} of ${ctx.maxRounds}.`,
    );
  }

  if (isProposer) {
    sections.push(
      `[DEBATE RULES]\n- Defend your position with evidence and reasoning.\n- Directly address the challenger's strongest objections.\n- Refine and strengthen your thesis each round.\n- Make genuine concessions when the challenger raises valid points.\n- Do not repeat arguments already made — advance the discussion.`,
    );
  } else {
    sections.push(
      `[DEBATE RULES]\n- Attack the proposer's strongest argument, not the weakest.\n- Provide specific, concrete critique — avoid vague objections.\n- Acknowledge valid points from the proposer (concessions show strength).\n- Introduce new angles and unexplored implications.\n- Do not repeat arguments already made — advance the discussion.`,
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
    `- Opponent current stance: ${mem.opponentStance ?? "not yet stated"} (confidence: ${mem.opponentConfidence ?? "N/A"})`,
  );
  memLines.push(
    `- Your key points so far:\n${renderBullets(mem.selfKeyPoints, "  - ")}`,
  );
  memLines.push(
    `- Opponent key points so far:\n${renderBullets(mem.opponentKeyPoints, "  - ")}`,
  );
  memLines.push(
    `- Your concessions so far:\n${renderBullets(mem.selfConcessions, "  - ")}`,
  );
  memLines.push(
    `- Opponent concessions so far:\n${renderBullets(mem.opponentConcessions, "  - ")}`,
  );
  memLines.push(
    `- Unresolved issues:\n${renderBullets(mem.unresolvedIssues, "  - ")}`,
  );
  if (mem.judgeSummary) {
    memLines.push(`- Previous judge summary: ${mem.judgeSummary}`);
  }
  sections.push(`[LONG-TERM DEBATE MEMORY]\n${memLines.join("\n")}`);

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
      `Opponent's last argument:\n${ctx.localWindow.opponentLastTurnFull}`,
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
      `[THIS TURN'S OBJECTIVE]\nDefend the proposition by:\n1. Respond to the challenger's 2 strongest objections.\n2. Clarify and strengthen your thesis.\n3. Make at least 1 forward-moving argument that advances the discussion.`,
    );
  } else {
    sections.push(
      `[THIS TURN'S OBJECTIVE]\nChallenge the proposer by:\n1. Identify 2 weakest links in the proposer's argument.\n2. Show where reasoning is incomplete or unsupported.\n3. Preserve fair concessions where the proposer made valid points.`,
    );
  }

  if (ctx.controls.shouldTryToConclude) {
    sections.push(
      `[CONCLUSION MODE]\nThe debate is approaching convergence. Summarize your final position clearly. Set wants_to_conclude to true in your debate_meta output if you believe the core disagreements have been addressed.`,
    );
  } else {
    sections.push(
      `[CONTINUE MODE]\nContinue engaging substantively. Set wants_to_conclude to false unless you genuinely believe all key disagreements have been fully addressed.`,
    );
  }

  sections.push(
    `[OUTPUT INSTRUCTIONS]\nAfter your argument, you MUST call the debate_meta tool with your structured summary:\n- stance: one of "strongly_agree", "agree", "neutral", "disagree", "strongly_disagree"\n- confidence: a number from 0.0 to 1.0\n- key_points: array of your main arguments this turn (2-4 items)\n- concessions: array of points you concede to the opponent (0+ items)\n- wants_to_conclude: boolean indicating if you want to end the debate`,
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// renderJudgePrompt — structured judge template
// ---------------------------------------------------------------------------

function renderJudgePrompt(ctx: JudgePromptContext): string {
  const sections: string[] = [];
  const defaultLang =
    "You MUST respond in the same language as the debate topic.";

  sections.push(`[TOPIC]\n${ctx.topic}`);

  sections.push(
    `[JUDGE TASK]\nYou are the judge evaluating this debate. Assess argument quality, evidence use, logical reasoning, and responsiveness to the opponent.\nThis is the evaluation after round ${ctx.roundNumber} of ${ctx.maxRounds}.`,
  );

  if (ctx.languageHint !== defaultLang) {
    sections.push(`[LANGUAGE]\n${ctx.languageHint}`);
  }

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
  sections.push(`[DEBATE SUMMARY]\n${summaryLines.join("\n")}`);

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
    `[JUDGING INSTRUCTIONS]\nEvaluate the debate so far. Consider the strength of arguments, use of evidence, logical reasoning, and willingness to engage with the opponent's points.\n${ctx.earlyEndGuidance}`,
  );

  sections.push(
    `[OUTPUT INSTRUCTIONS]\nYou MUST call the judge_verdict tool with your evaluation:\n- leading: "proposer", "challenger", or "tie"\n- score: { "proposer": 0-10, "challenger": 0-10 }\n- reasoning: your analysis of the debate (2-4 sentences)\n- should_continue: boolean indicating whether the debate should continue`,
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
