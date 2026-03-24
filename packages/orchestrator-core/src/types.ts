export type DebateRole = "proposer" | "challenger";

export type TerminationReason =
  | "max-rounds"
  | "convergence"
  | "judge-decision"
  | "error"
  | "interrupted"
  | "user-interrupt"
  | "stagnation-limit";

export interface Clarification {
  question: string;
  answer: string;
  answeredBy: "user" | "judge";
  roundNumber: number;
}

export interface DebateConfig {
  topic: string;
  maxRounds: number;
  judgeEveryNRounds: number;
  convergenceThreshold: number;
  proposerModel?: string;
  challengerModel?: string;
  judgeModel?: string;
}

export interface DebateMeta {
  stance:
    | "strongly_agree"
    | "agree"
    | "neutral"
    | "disagree"
    | "strongly_disagree";
  confidence: number;
  keyPoints: string[];
  concessions?: string[];
  wantsToConclude?: boolean;
  requestIntervention?: {
    type: "clarification" | "arbitration";
    question: string;
  };
}

export interface JudgeVerdict {
  leading: "proposer" | "challenger" | "tie";
  score: { proposer: number; challenger: number };
  reasoning: string;
  shouldContinue: boolean;
  repetitionScore?: { proposer: number; challenger: number };
  clarificationResponse?: {
    answered: boolean;
    answer?: string;
    relay?: string;
  };
}

export interface ConvergenceResult {
  converged: boolean;
  stanceDelta: number;
  mutualConcessions: number;
  bothWantToConclude: boolean;
  singlePartyStrongConvergence?: { role: DebateRole; rounds: number };
}

export interface DebateTurn {
  roundNumber: number;
  role: DebateRole;
  content: string;
  meta?: DebateMeta;
  judgeVerdict?: JudgeVerdict;
}

export interface DebateState {
  config: DebateConfig;
  phase: "idle" | "proposer-turn" | "challenger-turn" | "judging" | "completed";
  currentRound: number;
  turns: DebateTurn[];
  convergence: ConvergenceResult;
  terminationReason?: TerminationReason;
}
