# Incremental Prompt & Unified Token Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-layer prompt system with incremental prompts (full system context on Turn 1, only new opponent/judge content on Turn 2+), add dual-track token metrics, universal transcript fallback, and activate profile systemPrompt.

**Architecture:** Each adapter maintains a persistent provider session and a local `TurnRecord[]` transcript. The orchestrator builds either an initial prompt (Turn 1) or an incremental prompt (Turn 2+) and passes it to the adapter. Token metrics are split into local (measured at adapter boundary) and provider (as-is from SDK). Recovery uses `buildTranscriptRecoveryPrompt()` shared across all adapters.

**Tech Stack:** TypeScript, Vitest, Zod, pnpm monorepo (Turborepo)

**Spec:** [`docs/superpowers/specs/2026-03-26-incremental-prompt-design.md`](../specs/2026-03-26-incremental-prompt-design.md)

---

## File Structure

### New files
None — all changes are modifications to existing files.

### Key files to modify

| File | Responsibility |
|------|---------------|
| `packages/adapter-core/src/types.ts` | Add `TurnRecord`, `LocalTurnMetrics`, `ProviderUsageSemantics`, `ProviderUsageMetrics` types; extend `UsageUpdatedEvent` |
| `packages/orchestrator-core/src/context-builder.ts` | Replace 4-layer renderer with `buildInitialPrompt()`, `buildIncrementalPrompt()`, `buildJudgeInitialPrompt()`, `buildJudgeIncrementalPrompt()`, `defaultSystemPrompt()`, `buildTranscriptRecoveryPrompt()` |
| `packages/orchestrator/src/runner.ts` | Switch from `buildTurnPrompt()` to initial/incremental calls; pass systemPrompt; update prompt.stats |
| `packages/adapter-claude/src/event-mapper.ts` | Extract cache token fields from SDK result |
| `packages/adapter-codex/src/codex-adapter.ts` | Move META_TOOL_INSTRUCTIONS to Turn 1 only; add transcript tracking |
| `packages/adapter-codex/src/event-mapper.ts` | Add `semantics` field to usage events |
| `packages/adapter-claude/src/claude-adapter.ts` | Add transcript tracking |
| `packages/adapter-gemini/src/gemini-adapter.ts` | Replace `session.history` with `session.transcript`; add transcript tracking |
| `packages/tui/src/state/tui-store.ts` | Update usage.updated handler for new fields |
| `packages/tui/src/state/types.ts` | Extend `MetricsState` / `AgentUsage` for local metrics |

---

## Task 1: Add new types to adapter-core

**Files:**
- Modify: `packages/adapter-core/src/types.ts:131-149`
- Test: `packages/adapter-core/__tests__/types.test.ts` (new)

- [ ] **Step 1: Write failing test for new types**

```typescript
// packages/adapter-core/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import type {
  TurnRecord,
  LocalTurnMetrics,
  ProviderUsageSemantics,
  ProviderUsageMetrics,
  UsageUpdatedEvent,
} from "../src/types.js";

describe("new types compile correctly", () => {
  it("TurnRecord has required fields", () => {
    const record: TurnRecord = {
      roundNumber: 1,
      role: "proposer",
      content: "test content",
    };
    expect(record.roundNumber).toBe(1);
    expect(record.role).toBe("proposer");
    expect(record.content).toBe("test content");
    expect(record.meta).toBeUndefined();
  });

  it("LocalTurnMetrics has semantic/overhead/total split", () => {
    const metrics: LocalTurnMetrics = {
      semanticChars: 100,
      semanticUtf8Bytes: 200,
      adapterOverheadChars: 50,
      adapterOverheadUtf8Bytes: 100,
      totalChars: 150,
      totalUtf8Bytes: 300,
    };
    expect(metrics.totalChars).toBe(150);
    expect(metrics.totalTokensEstimate).toBeUndefined();
  });

  it("ProviderUsageMetrics includes semantics label", () => {
    const usage: ProviderUsageMetrics = {
      inputTokens: 100,
      outputTokens: 200,
      semantics: "per_turn",
    };
    expect(usage.semantics).toBe("per_turn");
    expect(usage.cacheReadTokens).toBeUndefined();
  });

  it("UsageUpdatedEvent supports new optional fields", () => {
    const event: UsageUpdatedEvent = {
      kind: "usage.updated",
      timestamp: Date.now(),
      adapterId: "claude",
      adapterSessionId: "s1",
      inputTokens: 3,
      outputTokens: 500,
      cacheReadTokens: 1200,
      cacheWriteTokens: 50,
      semantics: "session_delta_or_cached",
      localMetrics: {
        semanticChars: 100,
        semanticUtf8Bytes: 200,
        adapterOverheadChars: 0,
        adapterOverheadUtf8Bytes: 0,
        totalChars: 100,
        totalUtf8Bytes: 200,
      },
    };
    expect(event.cacheReadTokens).toBe(1200);
    expect(event.semantics).toBe("session_delta_or_cached");
    expect(event.localMetrics?.totalChars).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/types.test.ts`
Expected: FAIL — types `TurnRecord`, `LocalTurnMetrics`, `ProviderUsageMetrics` do not exist

- [ ] **Step 3: Add types to adapter-core/src/types.ts**

Add after the existing `UsageUpdatedEvent` interface (around line 136):

```typescript
// --- Incremental Prompt & Token Tracking Types ---

/** Record of a completed turn for universal transcript fallback */
export interface TurnRecord {
  roundNumber: number;
  role: "proposer" | "challenger" | "judge";
  content: string;
  /** Lightweight extracted metadata — avoids circular dependency on orchestrator-core */
  meta?: {
    stance?: string;
    confidence?: number;
    keyPoints?: string[];
    concessions?: string[];
  };
}

/** Local metrics measured at the adapter boundary before sending to provider */
export interface LocalTurnMetrics {
  semanticChars: number;
  semanticUtf8Bytes: number;
  adapterOverheadChars: number;
  adapterOverheadUtf8Bytes: number;
  totalChars: number;
  totalUtf8Bytes: number;
  totalTokensEstimate?: number;
  tokenEstimateMethod?: string;
}

export type ProviderUsageSemantics =
  | "per_turn"
  | "cumulative_thread_total"
  | "session_delta_or_cached"
  | "unknown";

export interface ProviderUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  raw?: unknown;
  semantics: ProviderUsageSemantics;
}
```

Then update the existing `UsageUpdatedEvent` to add new optional fields:

```typescript
export interface UsageUpdatedEvent extends BaseEvent {
  kind: "usage.updated";
  inputTokens: number;
  outputTokens: number;
  totalCostUsd?: number;
  // New fields for dual-track metrics
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  semantics?: ProviderUsageSemantics;
  localMetrics?: LocalTurnMetrics;
}
```

Also update `TurnCompletedEvent.usage` to include the same optional fields:

```typescript
export interface TurnCompletedEvent extends BaseEvent {
  kind: "turn.completed";
  status: "completed" | "interrupted" | "failed" | "timeout";
  durationMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    semantics?: ProviderUsageSemantics;
    localMetrics?: LocalTurnMetrics;
  };
}
```

Export the new types from `packages/adapter-core/src/index.ts` (add to existing exports).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/types.test.ts`
Expected: PASS

- [ ] **Step 5: Run all adapter-core tests**

Run: `pnpm --filter @crossfire/adapter-core test`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-core/src/types.ts packages/adapter-core/src/index.ts packages/adapter-core/__tests__/types.test.ts
git commit -m "feat(adapter-core): add TurnRecord, LocalTurnMetrics, ProviderUsageMetrics types"
```

---

## Task 2: Rewrite context-builder with incremental prompt functions

**Files:**
- Modify: `packages/orchestrator-core/src/context-builder.ts`
- Modify: `packages/orchestrator-core/__tests__/context-builder.test.ts`

This is the largest task. We replace the 4-layer rendering pipeline with new functions while keeping utility functions that other modules still use.

### Sub-task 2a: Write tests for new prompt builder functions

- [ ] **Step 1: Write failing tests for `defaultSystemPrompt()`**

Add to `packages/orchestrator-core/__tests__/context-builder.test.ts`:

```typescript
import {
  defaultSystemPrompt,
  buildInitialPrompt,
  buildIncrementalPrompt,
  buildJudgeInitialPrompt,
  buildJudgeIncrementalPrompt,
  buildTranscriptRecoveryPrompt,
} from "../src/context-builder.js";

describe("defaultSystemPrompt", () => {
  it("returns proposer identity for proposer role", () => {
    const prompt = defaultSystemPrompt("proposer");
    expect(prompt).toContain("proposer");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("returns challenger identity for challenger role", () => {
    const prompt = defaultSystemPrompt("challenger");
    expect(prompt).toContain("challenger");
    expect(prompt).toContain("stress-test");
  });

  it("returns judge identity for judge role", () => {
    const prompt = defaultSystemPrompt("judge");
    expect(prompt).toContain("judge");
    expect(prompt).toContain("assess");
  });
});
```

- [ ] **Step 2: Write failing tests for `buildInitialPrompt()`**

```typescript
describe("buildInitialPrompt", () => {
  it("includes system prompt, topic, round info, and schema", () => {
    const prompt = buildInitialPrompt({
      role: "proposer",
      topic: "AI pricing strategy",
      maxRounds: 10,
      systemPrompt: "You are the proposer. Be thorough.",
      schemaType: "debate_meta",
    });
    expect(prompt).toContain("You are the proposer. Be thorough.");
    expect(prompt).toContain("AI pricing strategy");
    expect(prompt).toContain("round 1");
    expect(prompt).toContain("10");
    expect(prompt).toContain("debate_meta");
    expect(prompt).toContain("stance");
    expect(prompt).toContain("key_points");
  });

  it("uses defaultSystemPrompt when systemPrompt is undefined", () => {
    const prompt = buildInitialPrompt({
      role: "challenger",
      topic: "Test topic",
      maxRounds: 5,
      systemPrompt: undefined,
      schemaType: "debate_meta",
    });
    expect(prompt).toContain("challenger");
    expect(prompt).toContain("stress-test");
  });

  it("includes META_TOOL_INSTRUCTIONS when provided", () => {
    const prompt = buildInitialPrompt({
      role: "proposer",
      topic: "Test",
      maxRounds: 5,
      systemPrompt: undefined,
      schemaType: "debate_meta",
      operationalPreamble: "TOOL INSTRUCTIONS HERE",
    });
    expect(prompt).toContain("TOOL INSTRUCTIONS HERE");
  });
});
```

- [ ] **Step 3: Write failing tests for `buildIncrementalPrompt()`**

```typescript
describe("buildIncrementalPrompt", () => {
  it("includes round header and opponent text with no truncation", () => {
    const longText = "A".repeat(5000);
    const prompt = buildIncrementalPrompt({
      roundNumber: 3,
      maxRounds: 10,
      opponentRole: "proposer",
      opponentText: longText,
      schemaRefreshMode: "reminder",
    });
    expect(prompt).toContain("Round 3/10");
    expect(prompt).toContain("proposer");
    expect(prompt).toContain(longText); // No truncation
    expect(prompt).toContain("debate_meta");
  });

  it("includes judge text when provided", () => {
    const prompt = buildIncrementalPrompt({
      roundNumber: 2,
      maxRounds: 5,
      opponentRole: "challenger",
      opponentText: "Opponent says...",
      judgeText: "Judge assessment here...",
      schemaRefreshMode: "reminder",
    });
    expect(prompt).toContain("Judge assessment");
    expect(prompt).toContain("Judge assessment here...");
    expect(prompt).toContain("Opponent says...");
  });

  it("uses full schema when schemaRefreshMode is 'full'", () => {
    const prompt = buildIncrementalPrompt({
      roundNumber: 3,
      maxRounds: 10,
      opponentRole: "proposer",
      opponentText: "test",
      schemaRefreshMode: "full",
    });
    expect(prompt).toContain("stance");
    expect(prompt).toContain("key_points");
    expect(prompt).toContain("confidence");
  });

  it("uses one-line reminder when schemaRefreshMode is 'reminder'", () => {
    const prompt = buildIncrementalPrompt({
      roundNumber: 2,
      maxRounds: 10,
      opponentRole: "proposer",
      opponentText: "test",
      schemaRefreshMode: "reminder",
    });
    expect(prompt).toContain("debate_meta");
    // Should NOT contain full field definitions
    expect(prompt).not.toContain("strongly_agree");
  });
});
```

- [ ] **Step 4: Write failing tests for judge prompt functions**

```typescript
describe("buildJudgeInitialPrompt", () => {
  it("includes system prompt, topic, both debater outputs, and verdict schema", () => {
    const prompt = buildJudgeInitialPrompt({
      topic: "AI strategy",
      maxRounds: 10,
      roundNumber: 1,
      proposerText: "Proposer argument...",
      challengerText: "Challenger argument...",
      systemPrompt: undefined,
    });
    expect(prompt).toContain("AI strategy");
    expect(prompt).toContain("Proposer argument...");
    expect(prompt).toContain("Challenger argument...");
    expect(prompt).toContain("judge_verdict");
    expect(prompt).toContain("leading");
    expect(prompt).toContain("score");
  });
});

describe("buildJudgeIncrementalPrompt", () => {
  it("includes round header and both debater outputs", () => {
    const prompt = buildJudgeIncrementalPrompt({
      roundNumber: 3,
      maxRounds: 10,
      proposerText: "P text",
      challengerText: "C text",
      schemaRefreshMode: "reminder",
    });
    expect(prompt).toContain("Round 3");
    expect(prompt).toContain("P text");
    expect(prompt).toContain("C text");
  });
});
```

- [ ] **Step 5: Write failing tests for `buildTranscriptRecoveryPrompt()`**

```typescript
describe("buildTranscriptRecoveryPrompt", () => {
  it("reconstructs full context from transcript", () => {
    const prompt = buildTranscriptRecoveryPrompt({
      systemPrompt: "You are the proposer.",
      topic: "Test topic",
      transcript: [
        { roundNumber: 1, role: "proposer", content: "My proposal" },
        { roundNumber: 1, role: "challenger", content: "My challenge" },
      ],
      schemaType: "debate_meta",
    });
    expect(prompt).toContain("You are the proposer.");
    expect(prompt).toContain("Test topic");
    expect(prompt).toContain("My proposal");
    expect(prompt).toContain("My challenge");
    expect(prompt).toContain("debate_meta");
  });

  it("uses budgeted mode when transcript exceeds budget", () => {
    const longContent = "X".repeat(100_000);
    const transcript = Array.from({ length: 10 }, (_, i) => ({
      roundNumber: Math.floor(i / 2) + 1,
      role: (i % 2 === 0 ? "proposer" : "challenger") as "proposer" | "challenger",
      content: longContent,
    }));
    const prompt = buildTranscriptRecoveryPrompt({
      systemPrompt: "System prompt",
      topic: "Topic",
      transcript,
      schemaType: "debate_meta",
      recoveryBudgetChars: 50_000,
    });
    expect(prompt).toContain("CONTEXT RECOVERED");
    expect(prompt.length).toBeLessThan(60_000);
    // Last 4 turns should be full
    expect(prompt).toContain(longContent); // At least some full turns
  });

  it("includes operationalPreamble when provided", () => {
    const prompt = buildTranscriptRecoveryPrompt({
      systemPrompt: "System",
      topic: "Topic",
      transcript: [],
      schemaType: "debate_meta",
      operationalPreamble: "META TOOL INSTRUCTIONS",
    });
    expect(prompt).toContain("META TOOL INSTRUCTIONS");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm --filter @crossfire/orchestrator-core exec vitest run __tests__/context-builder.test.ts`
Expected: FAIL — new functions don't exist yet

### Sub-task 2b: Implement new prompt builder functions

- [ ] **Step 7: Implement `defaultSystemPrompt()`**

Add to `packages/orchestrator-core/src/context-builder.ts`:

```typescript
export function defaultSystemPrompt(role: "proposer" | "challenger" | "judge"): string {
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
```

- [ ] **Step 8: Implement schema template helpers**

```typescript
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

const DEBATE_META_REMINDER = "(Remember to include your debate_meta JSON block at the end of your response.)";

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
```

- [ ] **Step 9: Implement `buildInitialPrompt()`**

```typescript
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
  parts.push(`[OUTPUT FORMAT]\n${DEBATE_META_SCHEMA_FULL}`);
  return parts.join("\n\n");
}
```

- [ ] **Step 10: Implement `buildIncrementalPrompt()`**

```typescript
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
    parts.push(`Judge assessment after round ${input.roundNumber - 1}:\n\n${input.judgeText}`);
    parts.push(`${input.opponentRole}'s response:\n\n${input.opponentText}`);
  } else {
    parts.push(`Round ${input.roundNumber}/${input.maxRounds}, ${input.opponentRole}'s response:`);
    parts.push(input.opponentText);
  }

  if (input.schemaRefreshMode === "full") {
    parts.push(DEBATE_META_SCHEMA_FULL);
  } else {
    parts.push(DEBATE_META_REMINDER);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 11: Implement judge prompt functions**

```typescript
export interface JudgeInitialPromptInput {
  topic: string;
  maxRounds: number;
  roundNumber: number;
  proposerText: string;
  challengerText: string;
  systemPrompt: string | undefined;
}

export function buildJudgeInitialPrompt(input: JudgeInitialPromptInput): string {
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

export function buildJudgeIncrementalPrompt(input: JudgeIncrementalPromptInput): string {
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
```

- [ ] **Step 12: Implement `buildTranscriptRecoveryPrompt()`**

```typescript
import type { TurnRecord } from "@crossfire/adapter-core";

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

export function buildTranscriptRecoveryPrompt(input: TranscriptRecoveryInput): string {
  const budget = input.recoveryBudgetChars ?? DEFAULT_RECOVERY_BUDGET_CHARS;
  const schema = input.schemaType === "judge_verdict"
    ? JUDGE_VERDICT_SCHEMA_FULL
    : DEBATE_META_SCHEMA_FULL;

  const header = [
    `[SYSTEM PROMPT]\n${input.systemPrompt}`,
    `[TOPIC]\n${input.topic}`,
    input.operationalPreamble ?? "",
    `[OUTPUT FORMAT]\n${schema}`,
  ].filter(Boolean).join("\n\n");

  // Try full rebuild first
  const fullTurns = input.transcript.map((t) =>
    `Round ${t.roundNumber}, ${t.role}'s response:\n\n${t.content}`
  ).join("\n\n---\n\n");

  const fullPrompt = `${header}\n\n${fullTurns}`;
  if (fullPrompt.length <= budget) return fullPrompt;

  // Budgeted rebuild: keep recent N turns full, compress older ones
  const recentCount = Math.min(RECENT_TURNS_TO_KEEP_FULL, input.transcript.length);
  const olderTurns = input.transcript.slice(0, -recentCount);
  const recentTurns = input.transcript.slice(-recentCount);

  const olderSummaries = olderTurns.map((t) => {
    if (t.meta) {
      const points = t.meta.keyPoints?.join("; ") ?? "";
      const concessions = t.meta.concessions?.join("; ") ?? "";
      return `Round ${t.roundNumber}, ${t.role} (summary): stance=${t.meta.stance}, confidence=${t.meta.confidence}, key_points=[${points}]${concessions ? `, concessions=[${concessions}]` : ""}`;
    }
    const preview = t.content.slice(0, 300);
    return `Round ${t.roundNumber}, ${t.role} (summary): ${preview}... [Turn truncated for recovery - original was ${t.content.length} chars]`;
  }).join("\n");

  const recentFull = recentTurns.map((t) =>
    `Round ${t.roundNumber}, ${t.role}'s response:\n\n${t.content}`
  ).join("\n\n---\n\n");

  const firstOlderRound = olderTurns.length > 0 ? olderTurns[0].roundNumber : "?";
  const lastOlderRound = olderTurns.length > 0 ? olderTurns[olderTurns.length - 1].roundNumber : "?";

  return [
    header,
    `[CONTEXT RECOVERED - turns from round ${firstOlderRound} to ${lastOlderRound} are summarized]\n\n${olderSummaries}`,
    recentFull,
  ].join("\n\n---\n\n");
}
```

- [ ] **Step 13: Update exports**

In `packages/orchestrator-core/src/context-builder.ts`, ensure all new functions are exported. Keep existing exports (`truncate`, `normalizeWhitespace`, `truncateWithHeadTail`, `buildPromptContext`, `buildTurnPrompt`, `buildJudgePrompt`, etc.) for now — they will be removed in a later task after runner is updated.

Also update `packages/orchestrator-core/src/index.ts` if needed (it re-exports `./context-builder.js` with `export *`, so new named exports are automatically available).

- [ ] **Step 14: Run tests to verify they pass**

Run: `pnpm --filter @crossfire/orchestrator-core exec vitest run __tests__/context-builder.test.ts`
Expected: New tests PASS, old tests still PASS (old functions kept temporarily)

- [ ] **Step 15: Run full orchestrator-core tests**

Run: `pnpm --filter @crossfire/orchestrator-core test`
Expected: All tests pass

- [ ] **Step 16: Commit**

```bash
git add packages/orchestrator-core/src/context-builder.ts packages/orchestrator-core/__tests__/context-builder.test.ts
git commit -m "feat(orchestrator-core): add incremental prompt builder functions"
```

---

## Task 3: Update runner to use incremental prompts

**Files:**
- Modify: `packages/orchestrator/src/runner.ts:130-179` (proposer/challenger prompt), `225-243` (judge prompt)
- Modify: `packages/orchestrator/__tests__/runner.test.ts`
- Modify: `packages/cli/src/wiring/create-adapters.ts:24-41`

- [ ] **Step 1: Update runner.test.ts for new prompt flow**

The existing `runner.test.ts` uses `createScriptedAdapter()` which mocks adapters and doesn't inspect prompt content. Most tests should still pass. Add a test that verifies the runner passes systemPrompt:

```typescript
// In runner.test.ts, add to the RunDebateOptions type used in tests
// Verify that the runner now passes systemPrompt from config
it("passes systemPrompt to initial prompt builder", async () => {
  // This test verifies the integration - prompts are constructed via
  // buildInitialPrompt/buildIncrementalPrompt now
  const events: AnyEvent[] = [];
  const bus = new DebateEventBus();
  bus.subscribe((e) => events.push(e));

  await runDebate({
    adapters,
    topic: "Test topic",
    maxRounds: 1,
    judgeEveryNRounds: 0,
    convergenceThreshold: 0.3,
    bus,
  });

  // Verify prompt.stats still emitted
  const promptStats = events.filter((e) => e.kind === "prompt.stats");
  expect(promptStats.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to confirm baseline**

Run: `pnpm --filter @crossfire/orchestrator exec vitest run __tests__/runner.test.ts`
Expected: Existing tests pass

- [ ] **Step 3: Update runner.ts — proposer/challenger prompt construction**

Replace the prompt construction in the round loop. The runner needs to:
1. Track turn count per role (to distinguish Turn 1 vs Turn 2+)
2. Track latest opponent/judge text per role
3. Determine schema refresh mode
4. Call `buildInitialPrompt()` or `buildIncrementalPrompt()`

Key changes in `runner.ts`:

```typescript
import {
  buildInitialPrompt,
  buildIncrementalPrompt,
  buildJudgeInitialPrompt,
  buildJudgeIncrementalPrompt,
} from "@crossfire/orchestrator-core";

// Before the round loop, add tracking state:
let proposerTurnCount = 0;
let challengerTurnCount = 0;
let lastJudgeText: string | undefined;

// Helper to determine schema refresh mode (cadence-based)
function schemaRefreshMode(turnCount: number, judgeEveryNRounds: number): "full" | "reminder" {
  if (turnCount === 0) return "full"; // Should not happen (Turn 1 uses buildInitialPrompt)
  if (judgeEveryNRounds > 0 && turnCount % judgeEveryNRounds === 0) return "full";
  return "reminder";
}

// Event-triggered schema refresh: force "full" after parse failures or format deviations
// Track per-role: lastMetaExtracted (boolean from projection after each turn)
let proposerConsecutiveFailures = 0;
let challengerConsecutiveFailures = 0;

// After each turn completes, check if debate_meta was extracted:
// If turn.meta is undefined after message.final → increment consecutive failures
// If failures >= 1 (single parse failure) or >= 2 (format deviation) → force "full" on next turn
// Reset counter when extraction succeeds
// Also force "full" after any session rebuild / compaction boundary
```

For proposer turn (replacing lines ~130-146):

```typescript
const proposerState = bus.snapshot();
let proposerPrompt: string;

if (proposerTurnCount === 0) {
  proposerPrompt = buildInitialPrompt({
    role: "proposer",
    topic: config.topic,
    maxRounds: config.maxRounds,
    systemPrompt: config.proposerSystemPrompt,
    schemaType: "debate_meta",
  });
} else {
  // Get challenger's last turn text from state
  const challengerLastTurn = proposerState.turns
    .filter((t) => t.role === "challenger")
    .at(-1);
  proposerPrompt = buildIncrementalPrompt({
    roundNumber: round,
    maxRounds: config.maxRounds,
    opponentRole: "challenger",
    opponentText: challengerLastTurn?.content ?? "",
    judgeText: lastJudgeText,
    schemaRefreshMode: schemaRefreshMode(proposerTurnCount, config.judgeEveryNRounds),
  });
  lastJudgeText = undefined; // Consumed
}
proposerTurnCount++;
```

Similarly for challenger turn and judge turns.

- [ ] **Step 4: Update create-adapters.ts to pass systemPrompt to runner**

In `packages/cli/src/wiring/create-adapters.ts`, ensure systemPrompt is captured from profile and made available to the runner. The runner's `RunDebateOptions` needs new optional fields:

```typescript
// In the options passed to runDebate:
proposerSystemPrompt?: string;
challengerSystemPrompt?: string;
judgeSystemPrompt?: string;
```

These come from `role.profile.systemPrompt` in the CLI wiring.

- [ ] **Step 5: Run runner tests**

Run: `pnpm --filter @crossfire/orchestrator exec vitest run __tests__/runner.test.ts`
Expected: All tests pass

- [ ] **Step 6: Build and verify no type errors**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/runner.ts packages/orchestrator/__tests__/runner.test.ts packages/cli/src/wiring/create-adapters.ts
git commit -m "feat(orchestrator): switch runner to incremental prompt builder"
```

---

## Task 4: Add transcript tracking to all adapters

**Files:**
- Modify: `packages/adapter-claude/src/claude-adapter.ts`
- Modify: `packages/adapter-codex/src/codex-adapter.ts`
- Modify: `packages/adapter-gemini/src/gemini-adapter.ts`
- Modify: corresponding test files

Each adapter must maintain a `transcript: TurnRecord[]` on its session state and append a record when `message.final` is received for a turn.

- [ ] **Step 1: Write failing test for Claude adapter transcript**

Add to `packages/adapter-claude/__tests__/claude-adapter.test.ts`:

```typescript
it("populates session transcript on message.final", async () => {
  // Send a turn that produces message.final
  const adapter = new ClaudeAdapter(mockQueryFn(/* ... */));
  const session = await adapter.startSession({ /* ... */ });
  await adapter.sendTurn(session, { turnId: "t-1", prompt: "test" });
  await waitForTurnCompleted(adapter);

  // Access transcript (exposed via session or adapter method)
  expect(session.transcript).toBeDefined();
  expect(session.transcript).toHaveLength(1);
  expect(session.transcript[0].content).toBeTruthy();
});
```

- [ ] **Step 2: Write failing test for Codex adapter transcript**

Similar test in `packages/adapter-codex/__tests__/codex-adapter.test.ts`.

- [ ] **Step 3: Write failing test for Gemini adapter transcript**

Similar test in `packages/adapter-gemini/__tests__/gemini-adapter.test.ts`.

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test`
Expected: New transcript tests fail

- [ ] **Step 5: Implement transcript tracking in Claude adapter**

In `packages/adapter-claude/src/claude-adapter.ts`:

```typescript
import type { TurnRecord } from "@crossfire/adapter-core";

// In SessionState (or on the handle), add:
// transcript: TurnRecord[]

// In processMessages(), when message.final is received:
// Append to session.transcript
```

The implementation pattern: store `transcript: TurnRecord[]` on the internal session state. When `message.final` fires, push a `TurnRecord` with the turn's role, round number, and full text. The role and round number must be passed in from the runner (via `TurnInput` or tracked internally).

**Simplest approach:** Add a `transcript` array to the session state object (the one keyed by `adapterSessionId`). The adapter records the `message.final` text along with turnId. The runner can later retrieve the transcript via a new `getTranscript(handle)` method on the adapter interface, or the adapter can expose it on `SessionHandle`.

Add `transcript: TurnRecord[]` to `SessionHandle` in `adapter-core/src/types.ts`:

```typescript
export interface SessionHandle {
  adapterSessionId: string;
  providerSessionId: string | undefined;
  adapterId: "claude" | "codex" | "gemini";
  transcript: TurnRecord[];
}
```

Initialize `transcript: []` in each adapter's `startSession()`. Append in the event processing when `message.final` is seen.

- [ ] **Step 6: Implement transcript tracking in Codex adapter**

Same pattern in `packages/adapter-codex/src/codex-adapter.ts`.

- [ ] **Step 7: Implement transcript tracking in Gemini adapter**

In `packages/adapter-gemini/src/gemini-adapter.ts`:
- Replace the never-populated `session.history` with `transcript: TurnRecord[]` on the session handle
- Append on `message.final`
- Update `buildStatelessPrompt()` (Path B) to use `buildTranscriptRecoveryPrompt()` instead of the old empty history

- [ ] **Step 8: Run all adapter tests**

Run: `pnpm test`
Expected: All tests pass (new and existing)

- [ ] **Step 9: Commit**

```bash
git add packages/adapter-core/src/types.ts packages/adapter-claude/ packages/adapter-codex/ packages/adapter-gemini/
git commit -m "feat(adapters): add universal transcript tracking to all adapters"
```

---

## Task 5: Update Claude event-mapper for cache tokens

**Files:**
- Modify: `packages/adapter-claude/src/event-mapper.ts:186-239`
- Modify: `packages/adapter-claude/__tests__/claude-adapter.test.ts`

- [ ] **Step 1: Write failing test for cache token extraction**

Add to `packages/adapter-claude/__tests__/claude-adapter.test.ts`:

```typescript
it("extracts cache_read and cache_write tokens from result usage", async () => {
  const sdkMessages = [
    { type: "system", subtype: "init", session_id: "s1", model: "claude" },
    { type: "assistant", content: [{ type: "text", text: "response" }] },
    {
      type: "result",
      subtype: "success",
      duration_ms: 100,
      usage: {
        input_tokens: 3,
        output_tokens: 500,
        cache_read_input_tokens: 1200,
        cache_creation_input_tokens: 50,
      },
    },
  ];
  const adapter = new ClaudeAdapter(mockQueryFn(sdkMessages));
  const session = await adapter.startSession({ profile: "test", workingDirectory: "." });
  const events = collectEvents(adapter);
  await adapter.sendTurn(session, { turnId: "t1", prompt: "test" });
  await waitForTurnCompleted(adapter);

  const usageEvent = events.find((e) => e.kind === "usage.updated");
  expect(usageEvent).toBeDefined();
  expect(usageEvent.inputTokens).toBe(3);
  expect(usageEvent.cacheReadTokens).toBe(1200);
  expect(usageEvent.cacheWriteTokens).toBe(50);
  expect(usageEvent.semantics).toBe("session_delta_or_cached");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-claude exec vitest run`
Expected: FAIL — `cacheReadTokens` not in usage event

- [ ] **Step 3: Update event-mapper.ts**

In `packages/adapter-claude/src/event-mapper.ts`, in the `case "result"` block (around line 198):

```typescript
case "result": {
  const rawUsage = msg.usage as Record<string, unknown> | undefined;
  let inputTokens = 0, outputTokens = 0, hasUsage = false;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;

  if (rawUsage) {
    hasUsage = true;
    inputTokens = Number(rawUsage.inputTokens ?? rawUsage.input_tokens ?? 0);
    outputTokens = Number(rawUsage.outputTokens ?? rawUsage.output_tokens ?? 0);
    // Extract cache token fields (Claude prompt caching)
    const cacheRead = rawUsage.cacheReadInputTokens ?? rawUsage.cache_read_input_tokens;
    if (cacheRead !== undefined) cacheReadTokens = Number(cacheRead);
    const cacheWrite = rawUsage.cacheCreationInputTokens ?? rawUsage.cache_creation_input_tokens;
    if (cacheWrite !== undefined) cacheWriteTokens = Number(cacheWrite);
  }

  const totalCostUsd = msg.total_cost_usd ?? msg.cost_usd;

  if (hasUsage) {
    events.push({
      kind: "usage.updated",
      inputTokens,
      outputTokens,
      totalCostUsd,
      cacheReadTokens,
      cacheWriteTokens,
      semantics: "session_delta_or_cached" as const,
    });
  }
  // ... rest unchanged
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crossfire/adapter-claude exec vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude/src/event-mapper.ts packages/adapter-claude/__tests__/
git commit -m "feat(adapter-claude): extract cache token fields from SDK usage"
```

---

## Task 6: Update Codex event-mapper for semantics label

**Files:**
- Modify: `packages/adapter-codex/src/event-mapper.ts:263-284`
- Modify: `packages/adapter-codex/__tests__/codex-adapter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it("usage.updated events include cumulative_thread_total semantics", async () => {
  // ... trigger a usage event via thread/tokenUsage/updated notification
  const usageEvent = events.find((e) => e.kind === "usage.updated");
  expect(usageEvent.semantics).toBe("cumulative_thread_total");
});
```

- [ ] **Step 2: Run test — fails**

- [ ] **Step 3: Update codex event-mapper**

In `packages/adapter-codex/src/event-mapper.ts`, in the `thread/tokenUsage/updated` case:

```typescript
return [{
  kind: "usage.updated",
  inputTokens,
  outputTokens,
  totalCostUsd: params.totalCostUsd ? Number(params.totalCostUsd) : undefined,
  semantics: "cumulative_thread_total" as const,
}];
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm --filter @crossfire/adapter-codex exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-codex/src/event-mapper.ts packages/adapter-codex/__tests__/
git commit -m "feat(adapter-codex): add cumulative_thread_total semantics to usage events"
```

---

## Task 7: Update Codex adapter — META_TOOL_INSTRUCTIONS to Turn 1 only

**Files:**
- Modify: `packages/adapter-codex/src/codex-adapter.ts:163-188`
- Modify: `packages/adapter-codex/__tests__/codex-adapter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it("appends META_TOOL_INSTRUCTIONS only on first turn", async () => {
  // ... send two turns
  // First turn: prompt should contain META_TOOL_INSTRUCTIONS marker
  // Second turn: prompt should NOT contain META_TOOL_INSTRUCTIONS marker
  const firstTurnRequest = await readNextMessage(); // turn/start
  expect(firstTurnRequest.params.input[0].text).toContain("Meta-Tool Usage");

  // Second turn
  await adapter.sendTurn(session, { turnId: "t-2", prompt: "second prompt" });
  const secondTurnRequest = await readNextMessage();
  expect(secondTurnRequest.params.input[0].text).not.toContain("Meta-Tool Usage");
});
```

- [ ] **Step 2: Run — fails (currently appends every turn)**

- [ ] **Step 3: Implement — track turn count in session state**

In `packages/adapter-codex/src/codex-adapter.ts`:

```typescript
// In session state, add: turnCount: 0
// In sendTurn():
const isFirstTurn = session.turnCount === 0;
const prompt = isFirstTurn
  ? input.prompt + META_TOOL_INSTRUCTIONS
  : input.prompt;
session.turnCount++;
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm --filter @crossfire/adapter-codex exec vitest run`

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-codex/src/codex-adapter.ts packages/adapter-codex/__tests__/
git commit -m "fix(adapter-codex): send META_TOOL_INSTRUCTIONS only on first turn"
```

---

## Task 8: Wire adapter recovery fallback paths

**Files:**
- Modify: `packages/adapter-claude/src/claude-adapter.ts`
- Modify: `packages/adapter-codex/src/codex-adapter.ts`
- Modify: `packages/adapter-gemini/src/gemini-adapter.ts`
- Modify: corresponding test files

Each adapter must detect provider session loss and fall back to `buildTranscriptRecoveryPrompt()`.

- [ ] **Step 1: Write failing test for Claude recovery**

In `packages/adapter-claude/__tests__/claude-adapter.test.ts`:

```typescript
it("falls back to transcript recovery when resume fails", async () => {
  // Create adapter where resume throws on second turn
  const queryFn = vi.fn()
    .mockImplementationOnce(/* normal first turn */)
    .mockImplementationOnce(() => { throw new Error("session not found"); })
    .mockImplementationOnce(/* recovery turn succeeds */);

  const adapter = new ClaudeAdapter(queryFn);
  const session = await adapter.startSession({ profile: "test", workingDirectory: "." });

  // First turn succeeds
  await adapter.sendTurn(session, { turnId: "t-1", prompt: "first" });
  await waitForTurnCompleted(adapter);

  // Second turn: resume fails → adapter should create fresh session with recovery prompt
  await adapter.sendTurn(session, { turnId: "t-2", prompt: "second" });
  await waitForTurnCompleted(adapter);

  // Verify: third call to queryFn should NOT have resume (new session)
  const thirdCall = queryFn.mock.calls[2];
  expect(thirdCall[0].options.resume).toBeUndefined();
  // Verify providerSessionId was updated (new session)
  expect(session.providerSessionId).not.toBeUndefined();
});
```

- [ ] **Step 2: Write failing test for Codex recovery**

```typescript
it("creates new thread when current thread is lost", async () => {
  // Simulate turn/start failing with thread-not-found error
  // Adapter should: thread/start a new thread, send recovery prompt, continue
});
```

- [ ] **Step 3: Write failing test for Gemini Path B using transcript recovery**

```typescript
it("uses buildTranscriptRecoveryPrompt for Path B fallback", async () => {
  // First turn succeeds (creates session)
  // Second turn: resume fails → Path B triggers
  // Verify Path B prompt includes all prior turn content from transcript
});
```

- [ ] **Step 4: Run tests — fail**

- [ ] **Step 5: Implement Claude recovery**

In `packages/adapter-claude/src/claude-adapter.ts`, wrap the `resume` call in a try-catch. On failure:
1. Generate new `sessionId`
2. Call `buildTranscriptRecoveryPrompt()` with `session.transcript`
3. Send as first turn of new session (no `resume`, with `sessionId` + `persistSession`)
4. Update `handle.providerSessionId`

```typescript
// In sendTurn(), wrap the queryFn call:
try {
  query = this.queryFn({ prompt, options: { resume: handle.providerSessionId, ... } });
} catch (err) {
  // Recovery: build new session from transcript
  const recoveryPrompt = buildTranscriptRecoveryPrompt({
    systemPrompt: session.systemPrompt,
    topic: session.topic,
    transcript: handle.transcript,
    schemaType: session.schemaType,
  });
  const newSessionId = crypto.randomUUID();
  handle.providerSessionId = undefined;
  query = this.queryFn({ prompt: recoveryPrompt, options: { sessionId: newSessionId, persistSession: true, ... } });
}
```

Note: The adapter needs access to `systemPrompt`, `topic`, and `schemaType` for recovery. These should be stored on the session state during `startSession()` or passed via `providerOptions`.

- [ ] **Step 6: Implement Codex recovery**

In `packages/adapter-codex/src/codex-adapter.ts`, wrap `turn/start` in try-catch. On failure:
1. Send new `thread/start` request
2. Build recovery prompt via `buildTranscriptRecoveryPrompt()` (include META_TOOL_INSTRUCTIONS as operationalPreamble)
3. Send recovery prompt as first turn of new thread
4. Update `session.currentThreadId` and `handle.providerSessionId`

- [ ] **Step 7: Implement Gemini Path B with transcript recovery**

In `packages/adapter-gemini/src/gemini-adapter.ts`:
- Replace the current `buildStatelessPrompt(incrementalPrompt, session.history)` call in Path B
- Use `buildTranscriptRecoveryPrompt(session.transcript)` instead
- The recovery prompt becomes the full prompt for the new subprocess

```typescript
// In the Path B fallback section (around line 195):
const recoveryPrompt = buildTranscriptRecoveryPrompt({
  systemPrompt: session.systemPrompt,
  topic: session.topic,
  transcript: handle.transcript,
  schemaType: session.schemaType,
});
// Run new process with recoveryPrompt (forceStateless=true)
```

- [ ] **Step 8: Run all adapter tests**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add packages/adapter-claude/ packages/adapter-codex/ packages/adapter-gemini/
git commit -m "feat(adapters): wire recovery fallback paths using buildTranscriptRecoveryPrompt"
```

---

## Task 9: Update TUI for new usage fields and enhanced display

**Files:**
- Modify: `packages/tui/src/state/types.ts:82-104`
- Modify: `packages/tui/src/state/tui-store.ts:685-707`
- Modify: `packages/tui/__tests__/tui-store.test.ts`

- [ ] **Step 1: Write failing test for local metrics in TUI**

```typescript
it("tracks local metrics from usage.updated events", () => {
  const store = new TuiStore();
  store.handleEvent({ kind: "debate.started", config: { topic: "T", maxRounds: 5, judgeEveryNRounds: 3, convergenceThreshold: 0.3 }, timestamp: Date.now() });
  store.handleEvent({ kind: "round.started", roundNumber: 1, speaker: "proposer", timestamp: Date.now() });

  store.handleEvent({
    kind: "usage.updated",
    timestamp: Date.now(),
    adapterId: "claude",
    adapterSessionId: "s1",
    inputTokens: 3,
    outputTokens: 500,
    semantics: "session_delta_or_cached",
    localMetrics: {
      semanticChars: 1000,
      semanticUtf8Bytes: 2000,
      adapterOverheadChars: 0,
      adapterOverheadUtf8Bytes: 0,
      totalChars: 1000,
      totalUtf8Bytes: 2000,
    },
  });

  const state = store.getState();
  expect(state.metrics.proposerUsage.localTotalChars).toBe(1000);
});
```

- [ ] **Step 2: Run test — fails**

- [ ] **Step 3: Extend TUI types**

In `packages/tui/src/state/types.ts`, extend `AgentUsage`:

```typescript
export interface AgentUsage {
  tokens: number;
  costUsd: number;
  localTotalChars?: number;
  localTotalUtf8Bytes?: number;
}
```

- [ ] **Step 4: Update tui-store usage.updated handler**

In `packages/tui/src/state/tui-store.ts`, in the `usage.updated` case:

```typescript
case "usage.updated": {
  const e = event as {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd?: number;
    localMetrics?: {
      totalChars: number;
      totalUtf8Bytes: number;
    };
  };
  const tokens = e.inputTokens + e.outputTokens;
  const cost = e.totalCostUsd ?? 0;
  this.state.metrics.totalTokens += tokens;
  if (e.totalCostUsd !== undefined) {
    this.state.metrics.totalCostUsd =
      (this.state.metrics.totalCostUsd ?? 0) + e.totalCostUsd;
  }
  if (this.activeSpeaker) {
    const usage =
      this.activeSpeaker === "proposer"
        ? this.state.metrics.proposerUsage
        : this.state.metrics.challengerUsage;
    usage.tokens += tokens;
    usage.costUsd += cost;
    if (e.localMetrics) {
      usage.localTotalChars = (usage.localTotalChars ?? 0) + e.localMetrics.totalChars;
      usage.localTotalUtf8Bytes = (usage.localTotalUtf8Bytes ?? 0) + e.localMetrics.totalUtf8Bytes;
    }
  }
  break;
}
```

- [ ] **Step 5: Add Codex delta computation and Claude observed-input display**

Extend `AgentUsage` further:

```typescript
export interface AgentUsage {
  tokens: number;
  costUsd: number;
  localTotalChars?: number;
  localTotalUtf8Bytes?: number;
  // Codex delta tracking
  previousCumulativeInput?: number;
  lastDeltaInput?: number;
  threadGeneration?: number; // Incremented on compaction/recovery/new thread
  // Claude cache display
  cacheReadTokens?: number;
  observedInputPlusCacheRead?: number; // inputTokens + cacheReadTokens
}
```

In the `usage.updated` handler, add:

```typescript
// Codex delta computation (only meaningful within same thread generation)
const semantics = (event as { semantics?: string }).semantics;
if (semantics === "cumulative_thread_total" && this.activeSpeaker) {
  const usage = this.activeSpeaker === "proposer"
    ? this.state.metrics.proposerUsage
    : this.state.metrics.challengerUsage;
  if (usage.previousCumulativeInput !== undefined) {
    usage.lastDeltaInput = e.inputTokens - usage.previousCumulativeInput;
  }
  usage.previousCumulativeInput = e.inputTokens;
}

// Claude observed input (cache-miss + cache-read)
if (semantics === "session_delta_or_cached" && this.activeSpeaker) {
  const cacheRead = (event as { cacheReadTokens?: number }).cacheReadTokens ?? 0;
  const usage = this.activeSpeaker === "proposer"
    ? this.state.metrics.proposerUsage
    : this.state.metrics.challengerUsage;
  usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + cacheRead;
  usage.observedInputPlusCacheRead = (usage.observedInputPlusCacheRead ?? 0) + e.inputTokens + cacheRead;
}
```

- [ ] **Step 6: Write tests for Codex delta and Claude cache display**

```typescript
it("computes Codex delta from cumulative usage", () => {
  const store = new TuiStore();
  store.handleEvent({ kind: "debate.started", config: { topic: "T", maxRounds: 5, judgeEveryNRounds: 3, convergenceThreshold: 0.3 }, timestamp: Date.now() });
  store.handleEvent({ kind: "round.started", roundNumber: 1, speaker: "challenger", timestamp: Date.now() });

  // First cumulative usage
  store.handleEvent({ kind: "usage.updated", inputTokens: 12000, outputTokens: 500, semantics: "cumulative_thread_total", timestamp: Date.now(), adapterId: "codex", adapterSessionId: "s1" });
  let state = store.getState();
  expect(state.metrics.challengerUsage.previousCumulativeInput).toBe(12000);
  expect(state.metrics.challengerUsage.lastDeltaInput).toBeUndefined(); // No previous to delta from

  // Second cumulative usage (round 2)
  store.handleEvent({ kind: "round.started", roundNumber: 2, speaker: "challenger", timestamp: Date.now() });
  store.handleEvent({ kind: "usage.updated", inputTokens: 28000, outputTokens: 1000, semantics: "cumulative_thread_total", timestamp: Date.now(), adapterId: "codex", adapterSessionId: "s1" });
  state = store.getState();
  expect(state.metrics.challengerUsage.lastDeltaInput).toBe(16000);
});

it("computes Claude observedInputPlusCacheRead", () => {
  const store = new TuiStore();
  store.handleEvent({ kind: "debate.started", config: { topic: "T", maxRounds: 5, judgeEveryNRounds: 3, convergenceThreshold: 0.3 }, timestamp: Date.now() });
  store.handleEvent({ kind: "round.started", roundNumber: 1, speaker: "proposer", timestamp: Date.now() });

  store.handleEvent({ kind: "usage.updated", inputTokens: 3, outputTokens: 500, cacheReadTokens: 1200, semantics: "session_delta_or_cached", timestamp: Date.now(), adapterId: "claude", adapterSessionId: "s1" });
  const state = store.getState();
  expect(state.metrics.proposerUsage.cacheReadTokens).toBe(1200);
  expect(state.metrics.proposerUsage.observedInputPlusCacheRead).toBe(1203);
});
```

- [ ] **Step 7: Run tests — pass**

Run: `pnpm --filter @crossfire/tui test`

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/state/types.ts packages/tui/src/state/tui-store.ts packages/tui/__tests__/
git commit -m "feat(tui): add Codex delta computation and Claude observed-input display"
```

---

## Task 10: Remove old 4-layer prompt code

**Files:**
- Modify: `packages/orchestrator-core/src/context-builder.ts` — remove old functions
- Modify: `packages/orchestrator-core/__tests__/context-builder.test.ts` — remove old tests

**Important:** Only do this AFTER Tasks 1-3 are complete and all tests pass with new prompt flow.

- [ ] **Step 1: Identify all consumers of old functions**

Search the codebase for imports of `buildTurnPrompt`, `buildJudgePrompt`, `buildPromptContext`, `buildJudgePromptContext`, `renderTurnPrompt`, `renderJudgePrompt`, `collectItems`, `PromptContext`, `JudgePromptContext`.

Run: `grep -r "buildTurnPrompt\|buildJudgePrompt\|buildPromptContext\|PromptContext\|JudgePromptContext\|collectItems\|renderTurnPrompt\|renderJudgePrompt" packages/ --include="*.ts" -l`

Verify that ONLY test files and `context-builder.ts` itself reference these. The runner should now use the new functions.

- [ ] **Step 2: Remove old functions from context-builder.ts**

Remove these functions and their associated types:
- `buildPromptContext()` (lines ~149-256)
- `buildJudgePromptContext()` (lines ~262-335)
- `renderTurnPrompt()` (lines ~341-483)
- `renderJudgePrompt()` (lines ~489-553)
- `buildTurnPromptFromState()` (lines ~559-571)
- `buildTurnPrompt()` (lines ~577-583)
- `buildJudgePrompt()` (lines ~585-587)
- `collectItems()` helper
- `renderBullets()` helper
- `PromptContext` interface
- `JudgePromptContext` interface
- `TurnPromptOptions` interface

**Keep:** `truncate()`, `normalizeWhitespace()`, `detectLanguageHint()` — used by other modules (`summary-generator.ts`, etc.).

**Also remove:** `truncateWithHeadTail()` — grep confirms it is only used in `context-builder.ts` and its test file. The spec lists it under "7.3 Removed."

- [ ] **Step 3: Remove old tests**

Remove test cases for the removed functions from `context-builder.test.ts`. Keep tests for `truncate` and `normalizeWhitespace`. Also remove `truncateWithHeadTail` tests (function is being removed).

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator-core/
git commit -m "refactor(orchestrator-core): remove 4-layer prompt renderer"
```

---

## Task 11: Local metrics recording in adapter layer

**Files:**
- Modify: `packages/adapter-claude/src/claude-adapter.ts`
- Modify: `packages/adapter-codex/src/codex-adapter.ts`
- Modify: `packages/adapter-gemini/src/gemini-adapter.ts`
- Modify: corresponding test files

Each adapter must measure `LocalTurnMetrics` (semantic + overhead + total) at the point where the prompt is sent, and include it in the `usage.updated` event.

- [ ] **Step 1: Write failing tests for local metrics in each adapter**

For each adapter, test that `usage.updated` events include `localMetrics` with the correct char/byte counts.

Example for Claude:
```typescript
it("emits localMetrics with usage.updated event", async () => {
  // ... send a turn with known prompt text
  const usageEvent = events.find((e) => e.kind === "usage.updated");
  expect(usageEvent.localMetrics).toBeDefined();
  expect(usageEvent.localMetrics.totalChars).toBeGreaterThan(0);
  expect(usageEvent.localMetrics.adapterOverheadChars).toBe(0); // Claude has no overhead
});
```

For Codex (first turn has META_TOOL_INSTRUCTIONS overhead):
```typescript
it("first turn localMetrics includes adapter overhead", async () => {
  // ... send first turn
  const usageEvent = events.find((e) => e.kind === "usage.updated");
  expect(usageEvent.localMetrics.adapterOverheadChars).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests — fail**

- [ ] **Step 3: Implement local metrics measurement**

In each adapter's `sendTurn()`, before sending to the provider:

```typescript
import type { LocalTurnMetrics } from "@crossfire/adapter-core";

function measureLocalMetrics(
  semanticText: string,
  overheadText: string,
): LocalTurnMetrics {
  const encoder = new TextEncoder();
  const semanticBytes = encoder.encode(semanticText).length;
  const overheadBytes = encoder.encode(overheadText).length;
  return {
    semanticChars: semanticText.length,
    semanticUtf8Bytes: semanticBytes,
    adapterOverheadChars: overheadText.length,
    adapterOverheadUtf8Bytes: overheadBytes,
    totalChars: semanticText.length + overheadText.length,
    totalUtf8Bytes: semanticBytes + overheadBytes,
  };
}
```

Store the metrics on the turn state and include in the `usage.updated` event emission.

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude/ packages/adapter-codex/ packages/adapter-gemini/
git commit -m "feat(adapters): measure and emit local turn metrics"
```

---

## Task 12: Remove prompt.stats from runner (moved to adapter layer)

**Files:**
- Modify: `packages/orchestrator/src/runner.ts` — remove prompt.stats emissions
- Modify: `packages/orchestrator/__tests__/runner.test.ts` — update if any tests check prompt.stats

Since local metrics are now measured and emitted by the adapter layer (in `usage.updated` events), the runner no longer needs to emit `prompt.stats` events separately.

- [ ] **Step 1: Search for prompt.stats consumers**

Run: `grep -r "prompt.stats" packages/ --include="*.ts" -l`

- [ ] **Step 2: Remove prompt.stats emissions from runner.ts**

Remove the `bus.push({ kind: "prompt.stats", ... })` blocks at lines ~135-141, ~168-174, ~227-233, etc.

- [ ] **Step 3: Update tests if needed**

If any tests assert on `prompt.stats` events, update them to check `usage.updated.localMetrics` instead.

- [ ] **Step 4: Run tests**

Run: `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/
git commit -m "refactor(orchestrator): remove prompt.stats, metrics now in adapter usage events"
```

---

## Task 13: Final integration verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: Clean build, no type errors

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Update architecture.md**

Update `docs/architecture.md`:
- Replace the "4-Layer Prompt Structure" section with "Incremental Prompt Strategy" description
- Update the token tracking section to describe dual-track metrics
- Add note about universal transcript fallback
- Update code location references for new functions

- [ ] **Step 5: Update READMEs if user-facing behavior changed**

Check if `README.md` or `README_zh.md` mention the 4-layer prompt or token display. Update if needed.

- [ ] **Step 6: Commit**

```bash
git add docs/ README.md README_zh.md
git commit -m "docs: update architecture and READMEs for incremental prompt design"
```

---

## Dependency Order

```
Task 1 (types)
  ├── Task 2 (context-builder) ──┐
  │                               ├── Task 3 (runner) ──── Task 10 (remove old code)
  │                               │                              │
  ├── Task 4 (transcripts) ──────┤                              │
  │                               │                              │
  │                               └── Task 8 (recovery paths)   │
  │                                                              │
  ├── Task 5 (Claude cache tokens)                               │
  ├── Task 6 (Codex semantics)                                   │
  ├── Task 7 (Codex META_TOOL Turn 1)                            │
  │                                                              │
  ├── Task 11 (local metrics) ── Task 12 (remove prompt.stats) ─┤
  │                                                              │
  └── Task 9 (TUI) ─────────────────────────────────────────────┤
                                                                 │
                                                    Task 13 (integration)
```

**Parallel tracks:**
- Tasks 5, 6, 7 can run in parallel (independent adapter changes)
- Task 9 (TUI) can run in parallel with Tasks 5-8
- Task 8 (recovery paths) depends on Tasks 2 (context-builder) + 4 (transcripts)
- Task 10 must wait for Task 3 (runner switched to new prompts)
- Task 11 (local metrics) depends on Tasks 1 (types) + 3 (runner uses new flow)
- Task 13 is the final gate
