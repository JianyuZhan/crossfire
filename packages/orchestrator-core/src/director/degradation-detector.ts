import type { DebateState, DebateTurn } from "../types.js";
import type { DegradationSignal } from "./types.js";

export function detectDegradation(
  state: DebateState,
  overlapThreshold = 0.7,
  minRounds = 3,
): DegradationSignal[] {
  const signals: DegradationSignal[] = [];

  for (const role of ["proposer", "challenger"] as const) {
    const roleTurns = state.turns
      .filter(
        (t) =>
          t.role === role && t.meta?.keyPoints && t.meta.keyPoints.length > 0,
      )
      .sort((a, b) => a.roundNumber - b.roundNumber);

    if (roleTurns.length < minRounds) continue;

    // Check last 2 rounds against the one before them
    const recent = roleTurns.slice(-2);
    const baseline = roleTurns[roleTurns.length - 3];

    const overlaps = recent.map((t) =>
      computeKeyPointOverlap(
        baseline.meta?.keyPoints ?? [],
        t.meta?.keyPoints ?? [],
      ),
    );

    const avgOverlap = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;

    // Also check overlap between the two most recent rounds themselves
    const selfOverlap = computeKeyPointOverlap(
      recent[0].meta?.keyPoints ?? [],
      recent[1].meta?.keyPoints ?? [],
    );

    const maxOverlap = Math.max(avgOverlap, selfOverlap);

    if (maxOverlap > overlapThreshold) {
      signals.push({
        type: "key-point-repetition",
        role,
        overlapScore: maxOverlap,
        rounds: 2,
        details: `${role} key_points overlap ${(maxOverlap * 100).toFixed(0)}% across last 2 rounds`,
      });
    }
  }

  return signals;
}

export function computeKeyPointOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const normalize = (s: string) => s.toLowerCase().trim();
  const setA = new Set(a.map(normalize));
  const setB = new Set(b.map(normalize));
  let matches = 0;
  for (const item of setA) {
    if (setB.has(item)) matches++;
  }
  // Jaccard-like: intersection / union
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : matches / union;
}
