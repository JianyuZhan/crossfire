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

  return {
    terminationReason:
      terminationReasonOverride ?? state.terminationReason ?? "unknown",
    roundsCompleted: state.currentRound,
    leading: verdict?.leading ?? "unknown",
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
    lines.push("*Detailed action plan saved to `action-plan.md`*");
  }
  return lines.join("\n");
}

export function generateActionPlan(
  state: DebateState,
  summary: DebateSummary,
): string {
  const lines: string[] = [];
  lines.push(`# Action Plan: ${state.config.topic}`);
  lines.push("");
  lines.push(
    `> Generated from ${summary.roundsCompleted}-round debate (${summary.totalTurns} turns). ` +
      `Termination: ${summary.terminationReason}.`,
  );
  lines.push("");

  // Section 1: Highlights / Consensus
  if (summary.consensus.length > 0) {
    lines.push("## Key Agreements (Consensus Highlights)");
    lines.push("");
    lines.push(
      "These points were acknowledged by both sides and form the foundation of the plan:",
    );
    lines.push("");
    for (let i = 0; i < summary.consensus.length; i++) {
      lines.push(`${i + 1}. ${summary.consensus[i]}`);
    }
    lines.push("");
  }

  // Section 2: Open Questions
  if (summary.unresolved.length > 0) {
    lines.push("## Open Questions (Unresolved)");
    lines.push("");
    lines.push(
      "These points remain disputed or insufficiently explored — they require further investigation:",
    );
    lines.push("");
    for (let i = 0; i < summary.unresolved.length; i++) {
      lines.push(`${i + 1}. ${summary.unresolved[i]}`);
    }
    lines.push("");
  }

  // Section 3: Judge Assessment
  if (summary.recommendedAction) {
    lines.push("## Judge Assessment");
    lines.push("");
    lines.push(summary.recommendedAction);
    lines.push("");
  }

  // Section 4: Stance Trajectory
  lines.push("## Stance Trajectory");
  lines.push("");
  lines.push("| Round | Proposer | Confidence | Challenger | Confidence |");
  lines.push("|-------|----------|------------|------------|------------|");
  const maxRounds = Math.max(
    summary.stanceTrajectory.proposer.length,
    summary.stanceTrajectory.challenger.length,
  );
  for (let i = 0; i < maxRounds; i++) {
    const p = summary.stanceTrajectory.proposer[i];
    const c = summary.stanceTrajectory.challenger[i];
    lines.push(
      `| ${p?.round ?? c?.round ?? "?"} | ${p?.stance ?? "-"} | ${p?.confidence ?? "-"} | ${c?.stance ?? "-"} | ${c?.confidence ?? "-"} |`,
    );
  }
  lines.push("");

  // Section 5: Score
  if (summary.judgeScore) {
    lines.push("## Final Score");
    lines.push("");
    lines.push(
      `**${summary.leading}** leads with score **${summary.judgeScore.proposer}** (proposer) vs **${summary.judgeScore.challenger}** (challenger).`,
    );
    lines.push("");
  }

  return lines.join("\n");
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
