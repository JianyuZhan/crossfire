// packages/orchestrator-core/src/projection.ts
import type { NormalizedEvent } from "@crossfire/adapter-core";
import { checkConvergence } from "./convergence.js";
import { DebateMetaSchema, JudgeVerdictSchema } from "./meta-tool.js";
import type { OrchestratorEvent } from "./orchestrator-events.js";
import type {
  ConvergenceResult,
  DebateConfig,
  DebateRole,
  DebateState,
  DebateTurn,
  JudgeVerdict,
} from "./types.js";

export type AnyEvent = NormalizedEvent | OrchestratorEvent;

const DEFAULT_CONFIG: DebateConfig = {
  topic: "",
  maxRounds: 10,
  judgeEveryNRounds: 3,
  convergenceThreshold: 0.3,
};

const DEFAULT_CONVERGENCE: ConvergenceResult = {
  converged: false,
  stanceDelta: 1.0,
  mutualConcessions: 0,
  bothWantToConclude: false,
};

export function projectState(events: AnyEvent[]): DebateState {
  let config: DebateConfig = DEFAULT_CONFIG;
  let phase: DebateState["phase"] = "idle";
  let currentRound = 0;
  const turns: DebateTurn[] = [];
  let terminationReason: DebateState["terminationReason"];
  let currentSpeaker: DebateRole | undefined;
  let judging = false;

  for (const event of events) {
    switch (event.kind) {
      case "debate.started":
        config = (event as { config: DebateConfig }).config;
        break;

      case "round.started": {
        const e = event as { roundNumber: number; speaker: DebateRole };
        currentRound = e.roundNumber;
        currentSpeaker = e.speaker;
        phase = e.speaker === "proposer" ? "proposer-turn" : "challenger-turn";
        turns.push({
          roundNumber: e.roundNumber,
          role: e.speaker,
          content: "",
        });
        break;
      }

      case "round.completed":
        currentSpeaker = undefined;
        break;

      case "judge.started":
        judging = true;
        phase = "judging";
        break;

      case "judge.completed": {
        judging = false;
        const e = event as { verdict?: JudgeVerdict; roundNumber: number };
        // Attach verdict to the last turn in this round (if available)
        if (e.verdict) {
          for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].roundNumber === e.roundNumber) {
              turns[i].judgeVerdict = e.verdict;
              break;
            }
          }
        }
        break;
      }

      case "debate.completed": {
        const e = event as { reason: DebateState["terminationReason"] };
        phase = "completed";
        terminationReason = e.reason;
        break;
      }

      case "debate.resumed":
        // No-op: state was already rebuilt from prior events
        break;

      case "user.inject":
      case "clarification.requested":
      case "clarification.provided":
      case "director.action":
        // Informational events for audit/replay. State changes are driven
        // by the actions these events describe (round.started, judge.started, etc.)
        break;

      case "message.final": {
        if (turns.length > 0) {
          const lastTurn = turns[turns.length - 1];
          const text = (event as { text: string }).text;
          lastTurn.content = text;
          // Extract debate_meta from fenced code block if no tool.call provided it
          if (!lastTurn.meta) {
            const meta = extractFencedJson(text, "debate_meta");
            if (meta) {
              const parsed = DebateMetaSchema.safeParse(meta);
              if (parsed.success) {
                lastTurn.meta = {
                  stance: parsed.data.stance,
                  confidence: parsed.data.confidence,
                  keyPoints: parsed.data.key_points,
                  concessions: parsed.data.concessions,
                  wantsToConclude: parsed.data.wants_to_conclude,
                  requestIntervention: parsed.data.request_intervention,
                };
              }
            }
          }
        }
        break;
      }

      case "tool.call": {
        const e = event as { toolName: string; input: unknown };
        if (e.toolName === "debate_meta" && turns.length > 0) {
          const parsed = DebateMetaSchema.safeParse(e.input);
          if (parsed.success) {
            const lastTurn = turns[turns.length - 1];
            lastTurn.meta = {
              stance: parsed.data.stance,
              confidence: parsed.data.confidence,
              keyPoints: parsed.data.key_points,
              concessions: parsed.data.concessions,
              wantsToConclude: parsed.data.wants_to_conclude,
              requestIntervention: parsed.data.request_intervention,
            };
          }
        }
        break;
      }

      default:
        break;
    }
  }

  const state: DebateState = {
    config,
    phase,
    currentRound,
    turns,
    convergence: DEFAULT_CONVERGENCE,
    terminationReason,
  };

  state.convergence = checkConvergence(state);

  return state;
}

/**
 * Extract JSON from a fenced code block with a specific label.
 * Supports both ```label and ```json patterns.
 */
function extractFencedJson(text: string, label: string): unknown | undefined {
  // Match ```label\n{...}\n``` or ```json\n{...}\n``` with label in surrounding text
  const pattern = new RegExp("```" + label + "\\s*\\n([\\s\\S]*?)\\n\\s*```");
  const match = text.match(pattern);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
