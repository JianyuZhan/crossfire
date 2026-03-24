import type { DebateState, DebateTurn, JudgeVerdict } from "../types.js";
import { filterUnresolved } from "../debate-memory.js";

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

  const proposerConcessions = new Set(
    state.turns
      .filter((t) => t.role === "proposer" && t.meta?.concessions)
      .flatMap((t) => t.meta?.concessions ?? []),
  );
  const challengerConcessions = new Set(
    state.turns
      .filter((t) => t.role === "challenger" && t.meta?.concessions)
      .flatMap((t) => t.meta?.concessions ?? []),
  );

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

export interface DeepSummaryItem {
  title: string;
  detail: string;
  nextSteps: string;
}

export interface DeepSummaryUnresolved {
  title: string;
  proposerPosition: string;
  challengerPosition: string;
  risk: string;
}

export interface DeepSummary {
  consensus: DeepSummaryItem[];
  unresolved: DeepSummaryUnresolved[];
}

const HTML_STYLES = `
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.7;color:#333;background:#fafafa}
h1{color:#1a1a2e;border-bottom:3px solid #6ec6ff;padding-bottom:.5rem;margin-bottom:.25rem}
h2{color:#2c5f8a;margin-top:2.5rem;font-size:1.3rem}
.meta{color:#888;font-size:.85rem;margin-bottom:2rem}
.card{padding:1rem 1.25rem;margin:.75rem 0;background:#fff;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.consensus .card{border-left:4px solid #6ec6ff}
.unresolved .card{border-left:4px solid #e74c3c}
.card h3{margin:0 0 .5rem;font-size:1.05rem}
.card .detail{color:#555;margin:.4rem 0}
.card .next-steps{color:#2c5f8a;font-weight:500;margin-top:.5rem}
.card .risk{color:#c0392b;font-weight:500;margin-top:.5rem}
.position{color:#555;margin:.25rem 0}
.position strong{color:#333}
`.trim();

export function generateActionPlanHtmlFromDeepSummary(
  topic: string,
  ds: DeepSummary,
  roundsCompleted: number,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const t = esc(topic);

  let body = "";

  if (ds.consensus.length > 0) {
    body += `<div class="consensus"><h2>Consensus — Detailed Action Plan</h2>\n`;
    for (const item of ds.consensus) {
      body += `<div class="card"><h3>${esc(item.title)}</h3>`;
      body += `<div class="detail">${esc(item.detail)}</div>`;
      body += `<div class="next-steps">Next steps: ${esc(item.nextSteps)}</div></div>\n`;
    }
    body += `</div>\n`;
  }

  if (ds.unresolved.length > 0) {
    body += `<div class="unresolved"><h2>Unresolved Issues &amp; Risks</h2>\n`;
    for (const item of ds.unresolved) {
      body += `<div class="card"><h3>${esc(item.title)}</h3>`;
      body += `<div class="position"><strong>Proposer:</strong> ${esc(item.proposerPosition)}</div>`;
      body += `<div class="position"><strong>Challenger:</strong> ${esc(item.challengerPosition)}</div>`;
      body += `<div class="risk">Risk: ${esc(item.risk)}</div></div>\n`;
    }
    body += `</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Crossfire: ${t}</title><style>${HTML_STYLES}</style></head>
<body>
<h1>Crossfire Debate Summary</h1>
<div class="meta">${t} · ${roundsCompleted} rounds · ${new Date().toLocaleDateString()}</div>
${body}
</body></html>`;
}

export function generateActionPlanHtmlFallback(
  topic: string,
  summary: DebateSummary,
): string {
  const ds: DeepSummary = {
    consensus: summary.consensus.map((c) => ({
      title: c,
      detail: "",
      nextSteps: "",
    })),
    unresolved: summary.unresolved.map((u) => ({
      title: u,
      proposerPosition: "",
      challengerPosition: "",
      risk: "",
    })),
  };
  return generateActionPlanHtmlFromDeepSummary(
    topic,
    ds,
    summary.roundsCompleted,
  );
}

/** Items both sides conceded — approximate match by substring overlap */
function computeConsensus(
  proposerConcessions: Set<string | undefined>,
  challengerConcessions: Set<string | undefined>,
): string[] {
  const all = new Set<string>();
  for (const pc of proposerConcessions) {
    if (!pc) continue;
    all.add(pc);
  }
  for (const cc of challengerConcessions) {
    if (!cc) continue;
    all.add(cc);
  }
  return [...all];
}

/** Key points NOT acknowledged by the other side's concessions */
function computeUnresolved(
  proposerPoints: string[],
  challengerPoints: string[],
  proposerConcessions: Set<string | undefined>,
  challengerConcessions: Set<string | undefined>,
): string[] {
  const allConcessions = [
    ...[...proposerConcessions].filter(Boolean),
    ...[...challengerConcessions].filter(Boolean),
  ] as string[];

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
