// packages/orchestrator-core/src/director/types.ts
import type { DebateRole, JudgeVerdict } from "../types.js";

export type TriggerJudgeReason =
  | "scheduled"
  | "stagnation"
  | "degradation"
  | "agent-request"
  | "user"
  | "final-review";

export type DirectorAction =
  | { type: "continue" }
  | {
      type: "trigger-judge";
      reason: TriggerJudgeReason;
      agentQuestion?: { source: DebateRole; question: string };
    }
  | {
      type: "end-debate";
      reason: "convergence" | "judge-decision" | "stagnation-limit";
    }
  | {
      type: "inject-guidance";
      target: DebateRole;
      text: string;
      source: "director" | "user";
    }
  | {
      type: "await-user";
      question: string;
      category: "missing-fact" | "user-preference" | "ambiguous-requirement";
    };

/** Priority order: higher index = higher priority */
export const ACTION_PRIORITY: Record<DirectorAction["type"], number> = {
  continue: 0,
  "inject-guidance": 1,
  "trigger-judge": 2,
  "await-user": 3,
  "end-debate": 4,
};

export interface StagnationSignal {
  type: "stance-frozen" | "one-sided-conclude" | "mutual-repetition";
  rounds: number;
  details: string;
}

export interface DegradationSignal {
  type: "key-point-repetition" | "low-novelty";
  role: DebateRole;
  overlapScore: number; // 0-1
  rounds: number;
  details: string;
}

export type DirectorSignal = StagnationSignal | DegradationSignal;

export interface DirectorConfig {
  /** Minimum rounds before first scheduled Judge trigger */
  minJudgeRound: number;
  /** Stagnation: how many rounds of frozen stance before signal */
  stagnationThreshold: number;
  /** Degradation: key_points overlap threshold (0-1) */
  degradationOverlapThreshold: number;
  /** Degradation: how many consecutive rounds before escalation */
  degradationRoundsThreshold: number;
  /** Max stagnation rounds before force-ending (after Judge has intervened) */
  stagnationLimit: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  minJudgeRound: 2,
  stagnationThreshold: 2,
  degradationOverlapThreshold: 0.7,
  degradationRoundsThreshold: 2,
  stagnationLimit: 4,
};

export interface PendingGuidance {
  target: DebateRole;
  text: string;
  priority: "normal" | "high";
  source: "director" | "user";
}

export interface PendingClarification {
  question: string;
  answer: string;
  answeredBy: "user" | "judge";
}
