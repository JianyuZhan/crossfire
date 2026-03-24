import type {
  AgentAdapter,
  NormalizedEvent,
  SessionHandle,
} from "@crossfire/adapter-core";
import { JudgeVerdictSchema } from "@crossfire/orchestrator-core";
import type { JudgeVerdict } from "@crossfire/orchestrator-core";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import type { DebateEventBus } from "./event-bus.js";

export interface JudgeTurnInput {
  turnId: string;
  prompt: string;
  roundNumber: number;
}

/**
 * Extract JSON from a fenced code block with a specific label.
 * Supports ```label\n{...}\n``` pattern.
 */
function extractFencedJson(text: string, label: string): unknown | undefined {
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

function parseVerdict(data: unknown): JudgeVerdict | undefined {
  const parsed = JudgeVerdictSchema.safeParse(data);
  if (!parsed.success) return undefined;
  return {
    leading: parsed.data.leading,
    score: parsed.data.score,
    reasoning: parsed.data.reasoning,
    shouldContinue: parsed.data.should_continue,
    repetitionScore: parsed.data.repetition_score,
    clarificationResponse: parsed.data.clarification_response,
  };
}

export async function runJudgeTurn(
  adapter: AgentAdapter,
  handle: SessionHandle,
  bus: DebateEventBus,
  input: JudgeTurnInput,
): Promise<JudgeVerdict | undefined> {
  let verdict: JudgeVerdict | undefined;

  // Listen for judge_verdict via tool.call OR fenced code block in message.final
  const unsub = bus.subscribe((event: AnyEvent) => {
    if (
      event.kind === "tool.call" &&
      "toolName" in event &&
      (event as NormalizedEvent & { toolName: string }).toolName ===
        "judge_verdict"
    ) {
      const toolEvent = event as NormalizedEvent & { input: unknown };
      const v = parseVerdict(toolEvent.input);
      if (v) verdict = v;
    }

    // Also extract from fenced code blocks in message.final
    if (
      event.kind === "message.final" &&
      "turnId" in event &&
      (event as NormalizedEvent).turnId === input.turnId
    ) {
      if (!verdict) {
        const text = (event as { text: string }).text;
        const json = extractFencedJson(text, "judge_verdict");
        if (json) {
          const v = parseVerdict(json);
          if (v) verdict = v;
        }
      }
    }
  });

  // Send the turn and wait for completion
  await adapter.sendTurn(handle, {
    turnId: input.turnId,
    prompt: input.prompt,
  });

  // Wait for turn.completed
  await new Promise<void>((resolve) => {
    const turnUnsub = bus.subscribe((event: AnyEvent) => {
      if (
        event.kind === "turn.completed" &&
        "turnId" in event &&
        (event as NormalizedEvent).turnId === input.turnId
      ) {
        turnUnsub();
        resolve();
      }
    });
  });

  unsub();
  return verdict;
}
