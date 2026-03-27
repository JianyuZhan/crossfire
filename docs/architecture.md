# Crossfire Architecture

> AI agent adversarial debate orchestrator — a pure TypeScript pnpm monorepo.

## Table of Contents

- [Overview](#overview)
- [Package Dependency Graph](#package-dependency-graph)
- [Layer 1: Adapter Layer](#layer-1-adapter-layer)
  - [AgentAdapter Interface](#agentadapter-interface)
  - [NormalizedEvent](#normalizedevent)
  - [AdapterCapabilities](#adaptercapabilities)
  - [SessionHandle](#sessionhandle)
  - [StartSessionInput](#startsessioninput)
  - [Adapter Internals](#adapter-internals)
    - [Claude Adapter](#claude-adapter)
    - [Codex Adapter](#codex-adapter)
    - [Gemini Adapter](#gemini-adapter)
  - [Contract Tests](#contract-tests)
- [Layer 2: Orchestrator](#layer-2-orchestrator)
  - [Core Types](#core-types)
    - [DebateConfig](#debateconfig)
    - [OrchestratorEvent (13 types)](#orchestratorevent-13-types)
    - [DebateState](#debatestate)
    - [DebateTurn](#debateturn)
    - [DebateMeta](#debatemeta-from-debate_meta-tool)
    - [JudgeVerdict](#judgeverdict-from-judge_verdict-tool)
    - [ConvergenceResult](#convergenceresult)
  - [Projection](#projection)
  - [DebateDirector](#debatedirector)
    - [DirectorAction](#directoraction)
    - [Judge Trigger Strategy (7 Sources)](#judge-trigger-strategy-7-sources)
    - [Convergence Rules (Enhanced)](#convergence-rules-enhanced)
    - [Repetition Degradation Treatment (2 Layers)](#repetition-degradation-treatment-2-layers)
    - [Clarification Flow](#clarification-flow)
    - [`/inject` Command System](#inject-command-system)
    - [Debate End Flow (Final Outcome)](#debate-end-flow-final-outcome)
    - [Director File Layout](#director-file-layout)
  - [DebateEventBus](#debateeventbus)
  - [Runner](#runner)
  - [Context Builder (Incremental Prompt System)](#context-builder-incremental-prompt-system)
    - [Incremental Prompt Builders](#incremental-prompt-builders)
    - [Utility Functions](#utility-functions)
  - [Judge Turn](#judge-turn)
  - [Action Plan Synthesis](#action-plan-synthesis)
    - [Pipeline Overview](#pipeline-overview)
    - [4-Layer Adaptive Synthesis Prompt](#4-layer-adaptive-synthesis-prompt)
    - [Budget Tiers](#budget-tiers)
    - [Round Scoring (Tier-1)](#round-scoring-tier-1)
    - [Round Selection](#round-selection)
    - [Reference Scoring (Tier-2)](#reference-scoring-tier-2)
    - [RoundSignals](#roundsignals-live-per-round-scoring-data)
    - [Quote Snippets (Layer 4)](#quote-snippets-layer-4)
    - [Phase Blocks (Long Tier)](#phase-blocks-long-tier)
    - [Iterative Shrink Algorithm](#iterative-shrink-algorithm)
    - [Debug Metadata](#debug-metadata)
    - [Three Quality Tiers](#three-quality-tiers)
    - [Component Responsibilities](#component-responsibilities)
    - [Runner Integration](#runner-integration)
- [Layer 3: TUI](#layer-3-tui)
  - [EventSource + PlaybackClock](#unification-eventsource--playbackclock)
  - [TuiStore](#tuistore)
    - [LiveAgentPanelState](#liveagentpanelstate)
    - [Other State Slices](#other-state-slices)
    - [Buffer Management Rules](#buffer-management-rules)
  - [Component Tree](#component-tree)
  - [CommandInput Modes](#commandinput-modes)
  - [Persistence (EventStore)](#persistence-eventstore)
  - [Replay](#replay)
- [Layer 4: CLI](#layer-4-cli)
  - [Profile System](#profile-system)
  - [Commands](#commands)
    - [`crossfire start`](#crossfire-start)
    - [`crossfire resume`](#crossfire-resume)
    - [`crossfire replay`](#crossfire-replay)
    - [`crossfire status`](#crossfire-status)
  - [Wiring Modules](#wiring-modules)
  - [Error Handling](#error-handling)
  - [EventStore Resume Support](#eventstore-resume-support)
- [Event Flow (End-to-End)](#event-flow-end-to-end)
- [Key Design Decisions](#key-design-decisions)
- [File Layout](#file-layout)
- [Testing Strategy](#testing-strategy)

---

## Overview

Crossfire pits multiple AI agents (Claude, Codex, Gemini) against each other in structured debates. One agent proposes, another challenges, and an optional judge evaluates convergence. The entire system is **event-sourced**: all state is derived from an ordered event stream, enabling deterministic replay, persistence, and resume.

```
User runs: crossfire start --topic "..." --proposer p --challenger c --judge j

          CLI (wiring)
            |
   +--------+--------+
   |        |        |
Adapters  Orchestrator       TUI
(3 providers) (Director + event loop) (Ink rendering)
   |        |        |
   +--------+--------+
            |
      DebateEventBus
     (unified event stream)
```

## Package Dependency Graph

```
@crossfire/cli
  ├── @crossfire/orchestrator
  │     └── @crossfire/orchestrator-core
  │           └── @crossfire/adapter-core
  ├── @crossfire/tui
  │     └── @crossfire/orchestrator-core
  │           └── @crossfire/adapter-core
  ├── @crossfire/adapter-claude ── @crossfire/adapter-core
  ├── @crossfire/adapter-codex  ── @crossfire/adapter-core
  └── @crossfire/adapter-gemini ── @crossfire/adapter-core
```

Key principle: **pure logic in `-core` packages, side effects in outer packages**. `orchestrator-core` and `adapter-core` have zero I/O dependencies.

---

## Layer 1: Adapter Layer

**Purpose:** Normalize three vastly different AI agent protocols into a single [`NormalizedEvent`](#normalizedevent) stream.

**Packages:** `adapter-core` (types + Zod + contract framework), `adapter-claude`, `adapter-codex`, `adapter-gemini`

### AgentAdapter Interface

```typescript
interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  startSession(input: StartSessionInput): Promise<SessionHandle>;
  sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle>;
  onEvent(cb: (e: NormalizedEvent) => void): () => void;
  approve?(req: ApprovalDecision): Promise<void>; // undefined when unsupported
  interrupt?(turnId: string): Promise<void>; // undefined when unsupported
  close(handle: SessionHandle): Promise<void>;
}
```

**Behavioral contracts:**

- **`sendTurn()`** resolves once the adapter has accepted the request and started its turn-processing path — NOT when the turn finishes. For Codex this includes a provider `turn/start` ack; Claude and Gemini return earlier, before first streamed output is guaranteed. Turn completion is signaled exclusively via the `turn.completed` event. Adapters measure local prompt metrics via `measureLocalMetrics(semanticText, overheadText)` and attach `LocalTurnMetrics` to `usage.updated` events.
- **`onEvent()`** delivers events from ALL sessions managed by the adapter instance. Consumers filter on `adapterSessionId`. The returned function unsubscribes entirely.
- **`approve()`/`interrupt()`** are `undefined` (not no-op stubs) when the adapter's capabilities don't support them. Callers must guard before invoking.
- **`close()`** is imperative, not observable — there is no `session.closed` event. Adapters attempt best-effort cleanup, but exact scope varies by provider implementation (for example, Codex closes the shared JSON-RPC client for that adapter instance).
- **Forward compatibility:** consumers MUST ignore unknown event `kind` values.

### NormalizedEvent

16-type discriminated union on the `kind` field. Every event carries:

```typescript
interface BaseEvent {
  kind: string; // discriminator
  timestamp: number; // Unix ms (Date.now())
  adapterId: "claude" | "codex" | "gemini";
  adapterSessionId: string; // adapter-assigned
  turnId?: string;
}
```

| Category       | Kinds                                       | Notable Fields                                                                       |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Session        | `session.started`                           | `providerSessionId` (always set), `capabilities: AdapterCapabilities`                |
| Text           | `message.delta`, `message.final`            | `text`, `stopReason?` (on final)                                                     |
| Thinking       | `thinking.delta`                            | `text`, `thinkingType: "raw-thinking" \| "reasoning-summary"`                        |
| Plan           | `plan.updated`                              | `steps` (Codex-specific)                                                             |
| Tools          | `tool.call`, `tool.progress`, `tool.result` | `toolUseId`, `toolName`, `input`/`output`; `tool.progress` adds `elapsedSeconds`     |
| Approvals      | `approval.request`, `approval.resolved`     | `requestId`, `approvalType`, `title`, `payload`, `suggestion?: "allow" \| "deny"`    |
| Subagents      | `subagent.started`, `subagent.completed`    | subagent lifecycle                                                                   |
| Metrics        | `usage.updated`                             | Type supports `inputTokens`, `outputTokens`, `totalCostUsd?`, `cacheReadTokens?`, `cacheWriteTokens?`, `semantics?`, `localMetrics?`; runtime schema currently validates the basic token/cost fields |
| Turn lifecycle | `turn.completed`                            | `status`, `durationMs`, `usage?` (type allows cache/semantics/localMetrics, but adapters may emit only basic usage or omit it entirely) |
| Errors         | `run.error`, `run.warning`                  | `message`; `run.error` adds `recoverable: boolean`                                   |

`turn.completed.status`: `"completed" | "interrupted" | "failed" | "timeout"`

#### Incremental Prompt & Token Tracking Types

For incremental prompt design and enhanced token tracking, `adapter-core` exports:

- **`TurnRecord`**: Universal transcript for recovery when provider sessions are lost. Contains `roundNumber`, `role`, `content`, and optional lightweight `meta` (stance, confidence, keyPoints, concessions).
- **`LocalTurnMetrics`**: Adapter-boundary measurement (chars/bytes split: semantic vs overhead vs total, optional token estimate). Enables cross-adapter comparison.
- **`ProviderUsageSemantics`**: Label for provider token reporting behavior: `"per_turn"` | `"cumulative_thread_total"` | `"session_delta_or_cached"` | `"unknown"`.
- **`ProviderUsageMetrics`**: Structured usage report with `semantics` label, optional `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens`, and `raw` passthrough for provider-specific data.

The event types carry the structured metrics fields above. `ProviderUsageMetrics.raw` is a helper type for adapter-local handling; it is not currently surfaced on normalized events.

### AdapterCapabilities

12-field capability detection:

- Resume: `supportsResume`, `resumeMode` (`"protocol-native" | "native-cli" | "stateless"`), `resumeStability`
- `supportsExternalHistoryInjection`, `supportsRawThinking`, `supportsReasoningSummary`
- `supportsPlan`, `supportsApproval`, `supportsInterrupt`, `supportsSubagents`
- `supportsStreamingDelta`

Contract tests enforce: if `supportsApproval=false`, adapter never emits `approval.*` events. Same for plan, subagents.

### SessionHandle

```typescript
interface SessionHandle {
  adapterSessionId: string;
  providerSessionId: string | undefined; // set timing varies by adapter
  adapterId: "claude" | "codex" | "gemini";
  transcript: TurnRecord[]; // universal transcript of completed turns — enables recovery prompt reconstruction
  recoveryContext?: RecoveryContext; // populated by runner — enables transcript-based session recovery
}

interface RecoveryContext {
  systemPrompt: string;
  topic: string;
  role: "proposer" | "challenger" | "judge";
  maxRounds: number;
  schemaType: "debate_meta" | "judge_verdict";
}
```

Every adapter initializes `transcript: []` in `startSession()` and appends a `TurnRecord` when a `message.final` event fires. Role and round number are resolved from explicit `TurnInput.role`/`TurnInput.roundNumber` fields, falling back to `parseTurnId()` which parses the `{p|c|j}-{N}` convention.

#### Recovery Fallback

When `recoveryContext` is set (by `runDebate()`) and an adapter detects provider session loss, it rebuilds the session using `buildTranscriptRecoveryPrompt()` from the transcript. Each adapter handles this differently:

- **Claude**: catches errors in `processMessages`, creates a new query without `resume`, uses recovery prompt
- **Codex**: catches `turn/start` JSON-RPC errors, creates a new thread via `thread/start`, retries with recovery prompt
- **Gemini**: in Path B fallback (session mismatch), uses `buildTranscriptRecoveryPrompt` instead of `buildStatelessPrompt` when transcript is available

### TurnInput

```typescript
interface TurnInput {
  prompt: string;
  turnId: string;
  timeout?: number;
  role?: "proposer" | "challenger" | "judge"; // hint for transcript tracking
  roundNumber?: number; // hint for transcript tracking
}
```

### StartSessionInput

```typescript
interface StartSessionInput {
  profile: string;
  workingDirectory: string;
  model?: string;
  mcpServers?: Record<string, unknown>;
  permissionMode?: "auto" | "approve-all" | "deny-all";
  providerOptions?: Record<string, unknown>; // systemPrompt goes here
}
```

### Adapter Internals

#### Claude Adapter

- **Transport:** In-process SDK `query()` async generator yielding `SDKMessage`
- **Session state:** `Map<adapterSessionId, QueryContext>` — per-session query tracking
- **`startSession()`** does NOT start a query. `providerSessionId` initializes as `undefined`.
- **`sendTurn()`** calls `query({ prompt, options })` with `resume: providerSessionId` for follow-up turns, `includePartialMessages: true`. Prompt is top-level param.
- **`providerSessionId`** set on first `sendTurn()` when `system/init` message arrives.
- **Usage semantics:** `"session_delta_or_cached"` — reports per-turn token deltas with `cacheReadInputTokens` and `cacheCreationInputTokens` extracted from SDK `result.usage`.
- **Approval:** `canUseTool` callback returns `PermissionResult` (allow with optional `updatedInput`, or deny with optional message/interrupt).
- **Hooks** (uppercase names): `PreToolUse` → `tool.call`, `PostToolUse` → `tool.result` (success), `PostToolUseFailure` → `tool.result` (error), `SubagentStart`/`SubagentStop` → `subagent.*` events.
- **`interrupt()`** uses `Query.interrupt()`.
- **`close()`** clears that session's query context only, not global listeners.

#### Codex Adapter

- **Transport:** Subprocess + bidirectional JSON-RPC 2.0 over stdio JSONL. Fixed to `--listen stdio://`.
- **`startSession()`**: `initialize` → `initialized` notification → `thread/start` with `{ model, cwd, approvalPolicy }` → returns `{ thread: { id } }` as `providerSessionId`.
- **`sendTurn()`**: `turn/start` with `{ threadId, input: [{ type: "text", text }] }` → returns `{ turn: { id, status } }`. Appends `META_TOOL_INSTRUCTIONS` only on first turn (turnCount === 0) to teach Codex how to invoke debate_meta/judge_verdict shell commands. Subsequent turns use incremental prompts without repetition.
- **Approval:** JSON-RPC request-response. Server sends `requestApproval`, adapter emits `approval.request`, orchestrator calls `approve()`, adapter sends JSON-RPC response back.
- **`interrupt()`**: `turn/interrupt` method.
- **Plan:** `turn/plan/updated` notification → `plan.updated` event.
- **Usage semantics:** `cumulative_thread_total` — `thread/tokenUsage/updated` reports cumulative totals across all turns in the thread.
- **Schema:** Types derived from `codex app-server generate-ts` output.

#### Gemini Adapter

- **Transport:** New subprocess per turn. Always uses `--prompt/-p` flag for automation compatibility.
- **`startSession()`** does NOT spawn a process. Processes start on `sendTurn()`.
- **`providerSessionId`** set on first init event's `session_id` field.
- **`session.started`** emitted only once (first `providerSessionId` acquisition). A→B fallback does NOT re-emit it.
- **`message.final`** synthesized by flushing `currentMessageBuffer` before `turn.completed`.
- **Three internal modules:**
  - `ProcessManager` — spawn, stdout readline, exit handling
  - `ResumeManager` — `--resume <sessionId>` arg building + init health checks
  - `PromptBuilder` — stateless fallback history assembly (summary mode by default)
- **Resume strategy (A→B fallback):**
  - Path A (default): `--resume <sessionId>` native protocol
  - Path B (fallback): Orchestrator-provided history compressed into prompt via `PromptBuilder`
  - **Fallback triggers:** resume path exits without a healthy init handshake (`code !== 0 || !initReceived`), `session_id` mismatch in init, or crash during resumed execution
  - Fallback emits `run.warning` explaining the switch
- **Turn-local state machine** (`TurnRuntimeState`): tracks `completed`, `fallbackTriggered`, `intentionalKill`, `resultSeen`. Ensures exactly ONE `turn.completed` per turn. Killing process for fallback sets `intentionalKill=true` so the exit handler ignores it.

### Contract Tests

Shared `runContractTests()` matrix with provider-specific mock factories:

| Category                     | What it tests                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Happy path                   | `session.started` exactly once, `turn.completed` exactly once per turn, usage carried                 |
| Multi-turn                   | Second turn works, no duplicate `session.started`                                                     |
| Tool lifecycle               | Matching `tool.call` / `tool.result` pairs, plus generic ordering invariants                          |
| Tool failure                 | `tool.result` with error                                                                              |
| Approval (capability-gated)  | `approval.request` → `approve()` → `approval.resolved`                                                |
| Interrupt (capability-gated) | Interrupt → exactly one `turn.completed` with `status: "interrupted"`                                 |
| Cleanup basics               | `close()` resolves, unsubscribe stops event delivery                                                  |
| Capability consistency       | `assertCapabilitiesConsistent(events, capabilities)` — e.g., `supportsPlan=false` → no `plan.updated` |

**`waitForTurnCompleted()`** matches by `turnId` to prevent cross-turn false matches.

**Integration tests** (gated by `RUN_INTEGRATION=1`): real adapters, cheapest models. Pre-checks are provider-specific: Codex/Gemini verify CLI availability via `--version`; Claude verifies the SDK package can be imported.

---

## Layer 2: Orchestrator

**Purpose:** Event-sourced debate loop — emit events, project state, make decisions. Consumes [`NormalizedEvent`](#normalizedevent) from [Layer 1](#layer-1-adapter-layer), drives the debate via [`DebateDirector`](#debatedirector), and publishes [`OrchestratorEvent`](#orchestratorevent-13-types) through the [`DebateEventBus`](#debateeventbus).

**Packages:** `orchestrator-core` (pure logic + DebateDirector), `orchestrator` (side effects)

### Core Types

#### DebateConfig

```typescript
interface DebateConfig {
  topic: string;
  maxRounds: number;
  judgeEveryNRounds: number; // >= 1, periodic judge intervention every N rounds; adaptive fallback when <= 0
  convergenceThreshold: number; // stance distance (0-1) below which debate auto-converges
  proposerModel?: string;
  challengerModel?: string;
  judgeModel?: string;
  proposerSystemPrompt?: string;   // from profile; passed to buildInitialPrompt on Turn 1
  challengerSystemPrompt?: string; // from profile; passed to buildInitialPrompt on Turn 1
  judgeSystemPrompt?: string;      // from profile; passed to buildJudgeInitialPrompt on Turn 1
}
```

#### OrchestratorEvent (13 types)

| Kind                      | Key Fields                                                            |
| ------------------------- | --------------------------------------------------------------------- |
| `debate.started`          | `config: DebateConfig`, `debateId?`, `roles?`                         |
| `debate.resumed`          | `fromRound: number`                                                   |
| `round.started`           | `roundNumber`, `speaker: "proposer" \| "challenger"`                  |
| `round.completed`         | `roundNumber`, `speaker`                                              |
| `judge.started`           | `roundNumber`                                                         |
| `judge.completed`         | `roundNumber`, `verdict?: JudgeVerdict`                               |
| `debate.completed`        | `reason: TerminationReason`, `summary?`, `outputDir?`                 |
| `user.inject`             | `target: "proposer" \| "challenger" \| "both" \| "judge"`, `text`, `priority` |
| `clarification.requested` | `source`, `question`, `judgeComment?`                                 |
| `clarification.provided`  | `answer`, `answeredBy: "user" \| "judge"`                             |
| `director.action`         | `action: DirectorAction`, `signals: DirectorSignal[]`                 |
| `synthesis.started`       | `timestamp`                                                           |
| `synthesis.completed`     | `quality: "llm-full" \| "local-structured" \| "local-degraded"`, optional `debug: SynthesisAuditSummary` |
| `synthesis.error`         | `phase: "judge-final" \| "prompt-assembly" \| "llm-synthesis" \| "file-write"`, `message` |

The last 6 events (`user.inject` through `synthesis.error`) are informational for audit/replay. State changes are driven by the actions they describe (e.g., `round.started`, `judge.started`). `director.action` is **mandatory and persisted** to JSONL — it enables meaningful replay explaining why Judge was triggered, why debate ended, or why guidance was injected.

**TerminationReason:** `"max-rounds" | "convergence" | "judge-decision" | "error" | "interrupted" | "user-interrupt" | "stagnation-limit"`

#### DebateState

```typescript
interface DebateState {
  config: DebateConfig;
  phase: "idle" | "proposer-turn" | "challenger-turn" | "judging" | "completed";
  currentRound: number;
  turns: DebateTurn[];
  convergence: ConvergenceResult;
  terminationReason?: TerminationReason;
}
```

#### DebateTurn

```typescript
interface DebateTurn {
  roundNumber: number;
  role: "proposer" | "challenger";
  content: string; // latest message.final text for that turn
  meta?: DebateMeta; // extracted from debate_meta tool_use
  judgeVerdict?: JudgeVerdict; // attached during judge phase
}
```

#### DebateMeta (from `debate_meta` tool)

```typescript
// Wire format (snake_case Zod schema):
{ stance, confidence, key_points, concessions?, wants_to_conclude?, request_intervention? }

// Domain model (camelCase):
interface DebateMeta {
  stance: "strongly_agree" | "agree" | "neutral" | "disagree" | "strongly_disagree";
  confidence: number;              // 0-1
  keyPoints: string[];
  concessions?: string[];
  wantsToConclude?: boolean;
  requestIntervention?: {          // agent requests clarification/arbitration
    type: "clarification" | "arbitration";
    question: string;
  };
  // Phase 1 enrichment fields (opportunistic, not mandatory):
  rebuttals?: Array<{ target: string; response: string }>;
  evidence?: Array<{ claim: string; source: string }>;
  riskFlags?: Array<{ risk: string; severity: "low" | "medium" | "high" }>;
  positionShifts?: Array<{ from: string; to: string; reason: string }>;
}
```

#### JudgeVerdict (from `judge_verdict` tool)

```typescript
// Wire format (snake_case): { leading, score, reasoning, should_continue, repetition_score?, clarification_response? }

interface JudgeVerdict {
  leading: "proposer" | "challenger" | "tie";
  score: { proposer: number; challenger: number };
  reasoning: string;
  shouldContinue: boolean;
  repetitionScore?: {
    // NEW: per-agent repetition measure (0-1)
    proposer: number;
    challenger: number;
  };
  clarificationResponse?: {
    // NEW: Judge answers or relays clarification
    answered: boolean;
    answer?: string; // if Judge answered directly
    relay?: string; // if Judge relays to user (rephrased question)
  };
}
```

Both tools are defined as Zod schemas. `debate_meta` flows through adapter `tool.call` events and is parsed during projection. `judge_verdict` is parsed in `runJudgeTurn()` and then carried into the event stream via `judge.completed`.

#### ConvergenceResult

```typescript
interface ConvergenceResult {
  converged: boolean;
  stanceDelta: number; // numeric distance between stances
  mutualConcessions: number; // count of overlapping concessions
  bothWantToConclude: boolean;
  singlePartyStrongConvergence?: {
    // NEW: Director uses to trigger Judge
    role: DebateRole;
    rounds: number;
  };
}
```

`checkConvergence(state)` computes `converged = bothWantToConclude || stanceDelta <= convergenceThreshold`, while also reporting `mutualConcessions` and `singlePartyStrongConvergence` as auxiliary signals. Single-party strong convergence is computed in the projection layer today, but is not yet consumed by `DebateDirector.evaluate()`.

### Projection

```typescript
function projectState(events: AnyEvent[]): DebateState;
// AnyEvent = NormalizedEvent | OrchestratorEvent
```

Pure reducer: processes events in order, deterministic replay guarantee. Unknown event kinds ignored (forward compatibility). `message.final` updates turn content, `tool.call` with [`debate_meta`](#debatemeta-from-debate_meta-tool) populates structured metadata, and `judge.completed` attaches the parsed verdict.

### DebateDirector

Pure-logic layer in `orchestrator-core` that manages all "when to do what" decisions. Extracts decision logic from `runner.ts` so the [Runner](#runner) becomes a pure executor.

```
DebateDirector (orchestrator-core, pure logic, zero I/O)
├── evaluate(state) -> DirectorAction
├── getGuidance(role) -> string | undefined
├── storeGuidance(target, text, priority, source)
│
├── JudgePolicy            Scheduled/stagnation/degradation Judge triggers
├── StagnationDetector     Both-sides-stuck detection
├── DegradationDetector    Single-side quality degradation detection
├── ClarificationPolicy    Classifies agent clarification/arbitration requests
└── SummaryGenerator       Structured summary + Final Outcome formatting
```

#### DirectorAction

```typescript
type DirectorAction =
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

type TriggerJudgeReason =
  | "scheduled"
  | "stagnation"
  | "degradation"
  | "convergence"
  | "agent-request"
  | "user"
  | "final-review";
```

**Action priority** (highest wins when multiple signals fire): `end-debate > await-user > trigger-judge > inject-guidance > continue`

#### Judge Trigger Strategy (7 Sources)

Judge triggers currently come from 3 places:

- `judge-policy.ts`: scheduled, stagnation, degradation, plus mandatory penultimate-round scheduling
- `DebateDirector.evaluate()`: convergence and agent-request
- `runner.ts`: user-triggered Judge (`/inject judge`) and final-review Judge

The scheduled trigger checks `state.config.judgeEveryNRounds` first for periodic intervention; the adaptive algorithm is used only as a fallback when `everyN <= 0`.

| Source                 | Condition                                                                                                      | Action                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Periodic scheduled** | Every N rounds (`judgeEveryNRounds`); falls back to adaptive algorithm (~30% first, ~25% subsequent) when `everyN <= 0`; penultimate round is always scheduled | `trigger-judge { reason: "scheduled" }`     |
| **Stagnation**         | Stance delta unchanged >= 2 rounds + one side wantsToConclude while other refuses                              | `trigger-judge { reason: "stagnation" }`    |
| **Degradation**        | key-point overlap > 70% across the detector's 3-turn window; first fires inject-guidance, then Judge          | `trigger-judge { reason: "degradation" }`   |
| **Convergence**        | `checkConvergence()` returns `converged = true`                                                                | `trigger-judge { reason: "convergence" }`   |
| **Agent request**      | `debate_meta.request_intervention` → ClarificationPolicy categorizes request                                   | `trigger-judge { reason: "agent-request" }` |
| **User**               | `/inject judge <instruction>` handled directly in `runner.ts`                                                  | direct Judge turn                           |
| **Final review**       | Debate ending (any reason), before `debate.completed`, handled directly in `runner.ts`                         | direct Judge turn                           |

#### Convergence Rules (Enhanced)

| Signal                                                         | Effect                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| `converged` = true (`bothWantToConclude` or `stanceDelta <= threshold`) | → `trigger-judge { reason: "convergence" }` when Judge is available |
| `bothWantToConclude` = true                                    | no direct end from Director; no-judge fallback in runner may end debate |
| `stanceDelta <= threshold`                                     | no direct end from Director; no-judge fallback in runner may end debate |
| Single-party `wantsToConclude` >= 2 rounds + confidence >= 0.9 | computed in convergence layer, not currently consumed by Director |
| Judge verdict `shouldContinue: false`                          | → `end-debate { reason: "judge-decision" }`             |
| Stagnation >= 3 rounds AND Judge intervened >= 2 times         | → `end-debate { reason: "stagnation-limit" }`           |

#### Repetition Degradation Treatment (2 Layers)

| Layer              | Trigger                                       | Behavior                                                                      |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| **Director layer** | DegradationDetector: overlap > 70% over a 3-turn comparison window | Active `inject-guidance` with specific instructions to shift argument |
| **Judge layer**    | Guidance issued but still degraded            | `trigger-judge { reason: "degradation" }`, verdict includes `repetitionScore` |

#### Clarification Flow

Current implementation status:

- `debate_meta.request_intervention` is parsed and categorized by `ClarificationPolicy`
- `JudgeVerdict.clarificationResponse` is parsed in `runJudgeTurn()`
- The end-to-end relay flow (`clarification.requested`, `clarification.provided`, blocking for user input, reinjection into later prompts) is **not wired yet**

`await-user` remains in [`DirectorAction`](#directoraction) as reserved surface area, but the current runner does not execute that branch.

#### `/inject` Command System

```
/inject proposer <text>          soft guidance, priority: normal
/inject challenger <text>        soft guidance, priority: normal
/inject both <text>              soft guidance to both sides
/inject! proposer <text>         hard intervention, priority: high
/inject! both <text>             hard intervention to both sides
/inject judge <text>             directly trigger Judge with user instruction
```

Currently only `/inject judge` is consumed by the live runner. Non-judge `user.inject` events are persisted for audit/replay, but prompt injection for proposer/challenger guidance is not yet wired into turn construction.

#### Debate End Flow (Final Outcome)

```
1. Main loop exits (max-rounds / convergence / judge-decision / stagnation-limit)
2. Runner directly starts an optional final-review Judge turn (30s timeout)
     → judge.completed pushed → PlanAccumulator captures verdict + patches RoundSignals.judgeImpact
3. synthesis.started event pushed  — TUI shows "generating summary" state
4. `generateSummary()` produces structured summary for `debate.completed.summary`
5. PlanAccumulator.flush() → snapshot() → EvolvingPlan with all roundAnalyses, roundSignals, judgeNotes
6. computeReferenceScores() → Tier-2 reference centrality scores
7. assembleAdaptiveSynthesisPrompt() → 4-layer adaptive prompt (see Action Plan Synthesis)
8. runFinalSynthesis() → new isolated adapter session → LLM generates action plan
9. Write action-plan.html + action-plan.md (or local fallback via draftToAuditReport)
10. synthesis.completed event pushed  — carries quality tier
11. debate.completed event pushed  — TRUE TERMINAL EVENT
```

`debate.completed` is pushed LAST, after all wrap-up. If the final-review Judge returns a verdict, `generateSummary()` incorporates it (leading side, score, reasoning); if Judge is unavailable or fails, Judge-sourced fields are set to `null`. The structured summary is carried in the `debate.completed` event's `summary` field. The current runner does not write a separate "Final Outcome" markdown block into the transcript.

#### Director File Layout

```
orchestrator-core/src/director/
  types.ts                -- DirectorAction, TriggerJudgeReason, Signal types, DirectorConfig
  debate-director.ts      -- Main: evaluate() + getGuidance() + storeGuidance()
  judge-policy.ts         -- Scheduled/stagnation/degradation Judge trigger logic
  stagnation-detector.ts  -- Both-sides-stuck detection (stance-frozen, one-sided-conclude)
  degradation-detector.ts -- Single-side key-point repetition detection
  clarification-policy.ts -- Classifies clarification/arbitration requests from debate_meta
  summary-generator.ts    -- Structured summary + Final Outcome markdown formatting
  index.ts                -- Barrel export
```

### DebateEventBus

```typescript
class DebateEventBus {
  push(event: AnyEvent): void; // append + notify all subscribers
  subscribe(cb: (event: AnyEvent) => void): () => void;
  snapshot(): DebateState; // projectState(allEvents)
  getEvents(): ReadonlyArray<AnyEvent>;
}
```

Merges both [`NormalizedEvent`](#normalizedevent) and [`OrchestratorEvent`](#orchestratorevent-13-types) streams. All consumers ([TUI](#layer-3-tui), [EventStore](#persistence-eventstore), TranscriptWriter, [Runner](#runner)) subscribe here. See [Event Flow](#event-flow-end-to-end) for the full data flow diagram.

### Runner

```typescript
async function runDebate(
  config: DebateConfig,
  adapters: AdapterMap,
  options?: RunDebateOptions,
): Promise<DebateState>;

interface AdapterMap {
  proposer: { adapter: AgentAdapter; session: SessionHandle };
  challenger: { adapter: AgentAdapter; session: SessionHandle };
  judge: { adapter: AgentAdapter; session: SessionHandle }; // always provided by CLI (TypeScript type still allows `judge?` for programmatic use)
}

interface RunDebateOptions {
  bus?: DebateEventBus; // injectable, otherwise created internally
  resumeFromState?: DebateState; // skip completed rounds on resume
  outputDir?: string; // where to write action-plan, transcript, etc.
  debateId?: string; // carried into debate.started event
  transcriptWriter?: TranscriptWriter; // provides cleanTranscript for adaptive synthesis
}
```

**Main loop** ([Director](#debatedirector)-driven):

1. Wire adapter `onEvent` callbacks into `bus.push()`
2. Create `DebateDirector` instance with `DirectorConfig`
3. Emit `debate.started` (or `debate.resumed` with `fromRound` if resuming)
4. Loop while not terminated:
   - **Proposer turn:** Turn 1 → `buildInitialPrompt({ role, topic, systemPrompt })`, Turn 2+ → `buildIncrementalPrompt({ opponentText, judgeText, schemaRefreshMode })` → `adapter.sendTurn()` → wait for `turn.completed` → check for `debate_meta` extraction (update consecutive failure counter)
   - **Challenger turn:** same incremental pattern (Turn 1 includes proposer's opening via `operationalPreamble`)
   - **Director evaluates:** `director.evaluate(bus.snapshot())` → push `director.action` event
   - **Execute action:** `end-debate` → break to Final Outcome; `trigger-judge` → run Judge turn (Turn 1 → `buildJudgeInitialPrompt`, Turn 2+ → `buildJudgeIncrementalPrompt`); `inject-guidance` → store inside `DebateDirector` only; `continue` → next round
   - **Schema refresh mode:** `getSchemaRefreshMode(turnCount, judgeEveryN, consecutiveFailures)` — returns `"full"` on Turn 1, cadence-aligned turns, or after parse failures; `"reminder"` otherwise
5. **Final Outcome flow:** optional final-review Judge turn → `generateSummary()` → emit `debate.completed` (with `summary` field) as **last** event

`waitForTurnCompleted()` listens on bus (not directly on adapters), matching by `turnId`.

### Context Builder (Incremental Prompt System)

The prompt system uses **incremental prompts** that rely on provider-native session/thread memory. Turn 1 sends the full system prompt + topic + schema; Turn 2+ sends only the opponent's latest response + optional judge feedback + schema reminder. This eliminates redundant context and enables provider-level caching of the stable prefix.

Core principle: **provider context = short-term working memory; [`DebateState`](#debatestate) = long-term fact memory.**

#### Incremental Prompt Builders

| Function                          | Purpose                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `defaultSystemPrompt(role)`       | Returns role-appropriate identity text for proposer/challenger/judge                            |
| `buildInitialPrompt(input)`       | Turn 1: system prompt + topic + round info + language hint + optional preamble + full schema    |
| `buildIncrementalPrompt(input)`   | Turn 2+: round header + optional judge text + opponent text (no truncation) + schema reminder   |
| `buildJudgeInitialPrompt(input)`  | Judge Turn 1: system prompt + topic + both debater outputs + verdict schema                     |
| `buildJudgeIncrementalPrompt(input)` | Judge Turn 2+: round header + both debater outputs + schema reminder or full                 |
| `buildTranscriptRecoveryPrompt(input)` | Reconstructs full context from transcript array; budgeted mode when transcript exceeds limit |

**Key design principles:**
- **No truncation** of opponent text — providers with session/thread handle context windowing natively.
- **Schema refresh modes**: full schema on Turn 1 and every N rounds, reminder-only otherwise.
- **Transcript recovery**: for stateless providers (Gemini) or after session loss, rebuilds context from event store with optional budget-aware summarization (default 200K chars).

#### Utility Functions

| Function                 | Location             | Purpose                                                                                      |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------- |
| `truncate(text, max)`    | `context-builder.ts` | Simple end truncation with `"..."` suffix                                                    |
| `normalizeWhitespace(t)` | `context-builder.ts` | Collapse 3+ newlines → 2, 2+ spaces → 1, trim                                                |
| `truncateWithHeadTail()` | `context-builder.ts` | Head 60% + tail 40% of space after `[...truncated...]` marker; used by transcript recovery   |
| `isAcknowledged()`       | `debate-memory.ts`   | Substring overlap on first 20 chars (case-insensitive)                                       |
| `filterUnresolved()`     | `debate-memory.ts`   | Key points minus acknowledged concessions, deduped                                           |

### Judge Turn

`runJudgeTurn()` — verdict extraction with graceful degradation. If judge doesn't call the `judge_verdict` tool, the runner continues without a verdict rather than crashing.

### Action Plan Synthesis

**Purpose:** Generate a high-quality action plan (`action-plan.html` + `action-plan.md`) as the primary deliverable of every debate. Uses a **4-layer adaptive prompt system** that replaces the old hard-truncation approach, plus a [three-tier quality pipeline](#three-quality-tiers): LLM full synthesis → local structured fallback → local degraded fallback. Triggered during the [Debate End Flow](#debate-end-flow-final-outcome).

**Key files:** `orchestrator-core/src/synthesis-prompt.ts`, `orchestrator-core/src/strip-internal-blocks.ts`, `orchestrator-core/src/markdown-renderer.ts`, `orchestrator/src/final-synthesis.ts`, `orchestrator/src/plan-accumulator.ts`

#### Pipeline Overview

```
Debate ends
  → PlanAccumulator.flush()                     (local data collection, no LLM)
  → computeReferenceScores(state, plan)         (Tier-2 reference centrality, pure)
  → assembleAdaptiveSynthesisPrompt(input)      (4-layer adaptive assembly, pure)
  → buildInstructions(tier) + result.prompt      (prepend synthesis instructions)
  → runFinalSynthesis()                          (new isolated adapter session)
  → adapter.sendTurn()                           (single self-contained prompt)
  → wait for turn.completed                      (authoritative completion signal)
  → extract text from message.final              (or accumulated message.delta)
  → renderMarkdownToHtml()                       (pure function, orchestrator-core)
  → fallback: improved local draftToAuditReport() template fill
```

The runner emits `synthesis.started` before and `synthesis.completed` (with quality tier) after the pipeline completes. TUI maps `synthesis.started` to its `summaryGenerating` display state.

#### 4-Layer Adaptive Synthesis Prompt

The synthesis prompt is built from 4 layers, assembled adaptively based on context budget:

| Layer | Content | Always Present |
|-------|---------|----------------|
| **Layer 1** | Structured plan: topic, consensus, unresolved, risks, evidence, compressed judge timeline, round summaries | Yes |
| **Layer 2** | Compressed round summaries: rich claims/challenges/risks from `RoundAnalysis`, or degraded one-line summaries | For non-full-text rounds |
| **Layer 3** | Full debate text: complete proposer + challenger transcript per round | For selected rounds |
| **Layer 4** | Quote snippets: 1-2 sentence excerpts from high-scoring compressed rounds | When budget allows and scoring data is available (medium/long tiers) |

#### Budget Tiers

`chooseInitialBudgetTier()` selects the assembly strategy based on debate size and context budget:

| Tier | Condition | Strategy |
|------|-----------|----------|
| **short** | Full transcript fits ≤ 60% of budget | All rounds full text (Layer 3) |
| **medium** | Exceeds short, ≤ 20 rounds, fits ≤ 85% | Recent K + top M by score as full text; rest compressed (Layer 2) |
| **long** | > 20 rounds OR medium doesn't fit | Phase blocks for earliest region + scoring-based selection |

#### Round Scoring (Tier-1)

`scoreRoundsForSynthesis()` scores each round `1..totalRounds` to determine full-text vs compressed:

```typescript
interface ScoredRound {
  roundNumber: number;
  score: number; // sum of all components
  breakdown: {
    recency: number;        // roundNumber / totalRounds (0..1)
    novelty: number;        // min(newClaimCount / 3, 1.0)
    concession: number;     // 1.0 if hasConcession, else 0
    consensusDelta: number; // 0.8 if consensus changed, else 0
    riskDelta: number;      // 0.6 if risks changed, else 0
    judgeImpact: number;    // 1.0 direction change, 0.5 weighted, 0.3 has verdict, 0
    reference: number;      // Tier-2 reference centrality (0..1), optional
  };
}
```

**Degraded-round zeroing:** rounds in `plan.degradedRounds` keep only `recency` + `judgeImpact`; all other components zero.

**Sparse fallback:** rounds missing `RoundSignals` get recency only.

#### Round Selection

`selectCriticalRounds(scored, totalRounds, recentK, impactM)`:

1. Always include the most recent `recentK` rounds (default 3) as full text
2. From remaining, promote top `impactM` (default 2) by score (tie-break: higher `roundNumber`)
3. Everything else is compressed

#### Reference Scoring (Tier-2)

`computeReferenceScores(state, plan): Map<number, number>` — computed at synthesis time, not during debate:

- **Rebuttal back-references:** later rounds' `meta.rebuttals[].target` matching earlier rounds' `keyPoints` (substring, first 30 chars)
- **Judge re-mentions:** later `plan.judgeNotes` whose `reasoning` references earlier rounds' key-point text
- Normalized to `0..1` range. Fed into `scoreRoundsForSynthesis()` as the `reference` component.

#### RoundSignals (Live Per-Round Scoring Data)

```typescript
interface RoundSignals {
  roundNumber: number;
  newClaimCount: number;   // historical dedup via trim+lowercase normalization
  hasConcession: boolean;  // strictly from meta.concessions, NOT consensus
  consensusDelta: boolean; // shallow set diff on plan.consensus before/after
  riskDelta: boolean;      // shallow set diff on plan.risks (risk|severity|round)
  judgeImpact: {
    hasVerdict: boolean;
    weighted: boolean;       // score spread >= 0.3
    directionChange: boolean; // leading side flipped vs previous judge note
  };
}
```

`RoundSignals` lives on `EvolvingPlan.roundSignals: RoundSignals[]`. It is built in `PlanAccumulator.processRound()` during normal forward processing and rebuilt in `rebuildRoundDerivedState()` when rounds are reprocessed/replayed. Judge impact is patched asynchronously by the `judge.completed` handler.

#### Quote Snippets (Layer 4)

`buildQuoteSnippets(cleanTranscript, compressedRounds, scored, budgetChars)`:

- Only considers compressed rounds with transcript data
- Only emits snippets when scored round data is available
- Ranked by score descending (tie-break: higher `roundNumber`)
- Extracts 1-2 sentence excerpts via `extractSnippet()`
- Rendered in ascending `roundNumber` order, capped by char budget
- Returns `{ text: string; sourceRounds: number[] }`

#### Phase Blocks (Long Tier)

For long-tier debates (> 20 rounds), the earliest compressed region is merged into phase blocks:

- Current implementation uses a fixed default window size `3`
- Blocks must be contiguous — gaps split into sub-blocks
- Aggregated content: union-deduped claims, merged concessions, merged risks, judge swing, stance trajectory
- **Re-aggregation rule:** when a round is promoted to full text, the block re-aggregates over remaining rounds (no stale data)

#### Iterative Shrink Algorithm

`shrinkToFit()` applies 6 steps in strict order when the assembled prompt exceeds the token budget:

| Step | Action | Detail |
|------|--------|--------|
| 1. `cutSnippets` | Halve Layer 4 snippet budget, rebuild; repeat up to 3× | Removes snippets entirely if budget exhausted |
| 2. `demoteFullText` | Demote lowest-numbered full-text round to compressed | Protects recent `recentK` rounds |
| 3. `trimSummaries` | Truncate round summaries to 80 chars, then 40 chars | Re-renders Layer 1 after each sub-step |
| 4. `compactLayer1` | Compact Layer 1 sections in order: evidence (top 5) → judge notes (terse) → unresolved/risks (truncated) → consensus (80 chars) | Preserves consensus last |
| 5. `emergency` | Drop Layer 4 entirely + truncate all Layer 2 to 2 lines each | Last resort before excerpt mode |
| 6. `excerptRecent` | Progressive excerpt truncation: `500+200` → `250+100` → `100+50` chars (proposer + challenger) | Final fallback |

Only steps that actually reduce token count are recorded in `shrinkTrace`.

#### Debug Metadata

`assembleAdaptiveSynthesisPrompt()` returns `{ prompt: string; debug: SynthesisDebugMetadata }`:

```typescript
interface SynthesisDebugMetadata {
  budgetTier: "short" | "medium" | "long";
  totalEstimatedTokens: number;
  budgetTokens: number;
  scores: ScoredRound[];
  fullTextRounds: number[];
  compressedRounds: number[];
  roundDisposition: Array<{
    roundNumber: number;
    disposition: "fullText" | "compressed" | "phaseBlockCovered" | "degradedSummary";
  }>;
  fitAchieved: boolean;
  warnings: string[];
  shrinkTrace: Array<{ step: string; beforeTokens: number; afterTokens: number; detail?: string }>;
  referenceScoreUsed: boolean;
  quoteSnippetSourceRounds: number[];
  phaseBlocks?: Array<{ phaseId: string; coveredRounds: number[]; excludedPromotedRounds?: number[] }>;
}
```

**Disposition priority:** `fullText > degradedSummary > phaseBlockCovered > compressed`. Ascending `roundNumber` order; exactly one entry per round after any shrink-time demotion/promotion is applied.

#### Three Quality Tiers

| Tier | Condition | Output |
|------|-----------|--------|
| **llm-full** | LLM synthesis succeeds | LLM-generated markdown → HTML with section cards |
| **local-structured** | LLM fails, but ≥ 3 structured items extracted from debate metadata | Fixed template fill from `draftToAuditReport()` |
| **local-degraded** | LLM fails, < 3 items extracted | Minimal template with degradation notice |

Quality tier is carried in the `synthesis.completed` event and displayed as a banner in the HTML/MD output (no banner for `llm-full`; warning for `local-structured`; strong warning for `local-degraded`).

#### Component Responsibilities

**PlanAccumulator** (orchestrator, local-only data collector)
- Subscribes to `DebateEventBus`, collects events during debate
- On `round.completed` (challenger): runs `buildFallbackRoundAnalysis()` locally (no LLM), computes `RoundSignals`, upserts `roundAnalyses` and `roundSignals`
- On `judge.completed`: records judge verdict via `updatePlanWithJudge()`, patches matching `RoundSignals.judgeImpact`
- **Replay-safe rebuild:** if an already-processed round is reprocessed, `rebuildRoundDerivedState()` rebuilds `roundSignals`, `roundAnalyses`, `degradedRounds`, and `seenKeyPoints` from the event log in ascending order from round 1
- `flush()`: drains microtask queue, freezes snapshot
- `snapshot()`: returns `EvolvingPlan` for both prompt building and fallback rendering
- Tracks `seenKeyPoints` for historical dedup of `newClaimCount`, `processedRounds` for replay detection

**assembleAdaptiveSynthesisPrompt()** (orchestrator-core, pure)
- Signature: `(input: AdaptiveSynthesisInput) → AdaptiveSynthesisResult`
- Never throws — catches errors and returns best-effort output with warnings
- Computes round universe from union of `cleanTranscript.keys()` + `state.turns` + `plan.roundSummaries`
- Reconstructs `cleanTranscript` from `state.turns` via `stripInternalBlocks()` when not provided
- Token estimation: conservative `Math.ceil(chars × 0.5)` (handles CJK safely)
- CJK detection (`detectCjkMajority()`): available for localized context notes

**buildFullTextSynthesisPrompt()** (orchestrator-core, legacy wrapper)
- Reconstructs `cleanTranscript` from `state.turns`, synthesizes a best-effort `EvolvingPlan` from `judgeNotes`/`roundSummaries`, delegates to `assembleAdaptiveSynthesisPrompt()`
- Appends full judge verdicts for backward compatibility (adaptive prompt compresses them in Layer 1)
- Graceful degradation: legacy callers without `score` on judge notes render without confidence shift

**runFinalSynthesis()** (orchestrator, effectful)
- Creates a **new isolated adapter session** (does NOT reuse debate session — prevents context pollution)
- Sends one turn with `turnId: "synthesis-final"`
- Subscribes directly to adapter events (not through bus) — tracks `message.delta`, `message.final`, `turn.completed`
- If multiple `message.final` events arrive, keeps the longest
- Prefers `message.final`; falls back to accumulated `message.delta` buffer
- Uses caller-provided timeout via `Promise.race`
- Always calls `adapter.close()` in `finally` block — synthesis session must not leak

**renderMarkdownToHtml()** (orchestrator-core, pure)
- Signature: `(markdown: string, meta: MarkdownReportMeta) → string`
- Security-first: HTML-escape ALL input first (`<` → `&lt;`), THEN apply markdown substitutions
- Splits markdown by `## ` headings into card-based HTML sections
- Inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `- list items`, `| tables |`
- URL safety: only `http:`, `https:`, `mailto:` schemes allowed in links
- Includes CSS styling for cards, notices, tables, responsive layout

**draftToAuditReport()** (orchestrator-core, fallback path)
- Template quality improvements over original:
  - `nextSteps`: extracts action verb from argument text, or "See consensus detail above." (not "Define concrete implementation steps.")
  - `mitigation`: "Not discussed in debate." (not "Requires further analysis.")
  - `usedBy`: "unknown" (not generic "debate participant")
  - `unresolvedIssues`: populated from both sides' key points when both disagree

**buildFallbackRoundAnalysis()** (orchestrator-core, pure)
- Divergence detection: when both sides have `disagree`/`strongly_disagree` stance, key points become divergence items
- Consensus classification: only mutual concessions count as consensus (first-20-char normalized match); single-side concessions are listed separately

**TranscriptWriter** (orchestrator, side-effect)
- `getCleanTranscript(): Map<number, { proposer?: string; challenger?: string }>` — returns stripped per-speaker text keyed by round number; text already stripped at ingestion time via `stripInternalBlocks()`
- Writes `transcript.md` alongside `transcript.html` on `close()`
- Exposed via `BusBundle.transcriptWriter` for runner access

**stripInternalBlocks()** (orchestrator-core, pure)
- Extracted to `strip-internal-blocks.ts` for shared use by both transcript generation and adaptive synthesis
- Strips `debate_meta` / `judge_verdict` tool-use JSON from raw agent output

#### Runner Integration

```typescript
// In runner.ts — after debate loop exits, before debate.completed
bus.push({ kind: "synthesis.started", timestamp: Date.now() });

// 1. Flush local accumulator
await accumulator.flush();
const plan = accumulator.snapshot();
const draft = buildDraftReport(plan);

// 2. Primary path: LLM final synthesis (new isolated session)
if (synthesisEnabled) {
  const adapter = adapters.judge?.adapter ?? adapters.proposer.adapter;
  const cleanTranscript = options?.transcriptWriter?.getCleanTranscript();
  const referenceScores = computeReferenceScores(preCompleteState, plan);
  const result = assembleAdaptiveSynthesisPrompt({
    state: preCompleteState, plan,
    topic: preCompleteState.config.topic,
    cleanTranscript,
    config: { contextTokenLimit: 128_000 },
    referenceScores: referenceScores.size > 0 ? referenceScores : undefined,
  });
  const prompt = buildInstructions(result.debug.budgetTier) + "\n\n" + result.prompt;
  const markdown = await runFinalSynthesis(adapter, prompt, 180_000);
  if (markdown) → write action-plan.md + action-plan.html via renderMarkdownToHtml()
}

// 3. Fallback: improved local template
if (!markdown) → draftToAuditReport(draft) → renderActionPlanHtml/Markdown()

bus.push({ kind: "synthesis.completed", quality, timestamp: Date.now() });
```

Synthesis is controlled by `CROSSFIRE_SYNTHESIZER` env var (`!== "0"` to enable, enabled by default).

---

## Layer 3: TUI

**Purpose:** Event-driven terminal UI for live rendering and replay, powered by Ink (React for CLI). Subscribes to [`DebateEventBus`](#debateeventbus) and projects events into render-ready state via [`TuiStore`](#tuistore). Shares the same [`DebateState`](#debatestate) projection as the orchestrator.

**Package:** `tui` (depends on adapter-core, orchestrator-core, ink, react)

### Unification: EventSource + PlaybackClock

The TUI doesn't know if it's live or replay — it consumes events from an `EventSource` (see [Key Design Decision #4](#key-design-decisions)):

```typescript
interface EventSource {
  subscribe(cb: (event: AnyEvent) => void): () => void;
  start(): Promise<void>;
  stop(): void;
}
// LiveEventSource — wraps DebateEventBus (real-time)
// ReplayEventSource — reads JSONL, respects PlaybackClock

interface PlaybackClock {
  speed: number;
  paused: boolean;
  setSpeed(multiplier: number): void;
  pause(): void;
  resume(): void;
  delay(originalDeltaMs: number): Promise<void>;
}
// RealTimeClock — no-op delay, for live mode
// ScaledClock — applies speed multiplier, supports pause
```

### TuiStore

Lightweight projection from raw events into render-ready state. Prevents excessive re-renders from high-frequency [`thinking.delta`/`message.delta`](#normalizedevent).

**Usage tracking:** The `usage.updated` handler uses the `semantics` field to apply provider-specific logic:
- **Codex** (`cumulative_thread_total`): computes per-event deltas from the running cumulative totals (both input and output), storing `_lastCumulativeInput`/`_lastCumulativeOutput` as internal tracking fields.
- **Claude** (`session_delta_or_cached`): accumulates `cacheReadTokens` and tracks `observedInputPlusCacheRead` for cache-aware display.
- **Local metrics**: accumulates `localTotalChars` / `localTotalUtf8Bytes` from the `localMetrics` field on each event.

```typescript
interface TuiState {
  proposer: LiveAgentPanelState;
  challenger: LiveAgentPanelState;
  rounds: TuiRound[];              // historical round snapshots for scroll/replay
  judgeResults: JudgeRoundResult[]; // per-round judge verdicts
  judge: JudgeStripState;
  metrics: MetricsState;
  command: CommandState;
  debateState: DebateState;        // full projected state
  summaryGenerating?: boolean;     // true between synthesis.started and debate.completed
  summary?: DebateSummaryView;     // structured debate summary for display
}
```

#### LiveAgentPanelState

```typescript
interface LiveAgentPanelState {
  role: "proposer" | "challenger";
  agentType?: string;
  model?: string;
  status: "idle" | "thinking" | "tool" | "speaking" | "done" | "error";
  thinkingText: string; // ~4096 chars, front-trimmed
  currentMessageText: string; // replaced entirely by message.final
  tools: LiveToolEntry[]; // current turn only
  latestPlan?: PlanStep[]; // Codex plan
  warnings: string[];
  error?: string;
  turnDurationMs?: number;
  turnStatus?: "completed" | "interrupted" | "failed" | "timeout";
}

interface LiveToolEntry {
  toolUseId: string;
  toolName: string;
  inputSummary: string; // truncated
  status: "running" | "done" | "error";
  elapsedMs?: number;
  resultSummary?: string; // truncated
  expanded: boolean; // user toggle
}
```

#### Other State Slices

```typescript
interface MetricsState {
  debateId?: string;
  currentRound: number;
  maxRounds: number;
  convergencePercent: number; // 0-100
  stanceDelta: number;
  proposerStance?: string;
  challengerStance?: string;
  proposerConfidence?: number;
  challengerConfidence?: number;
  mutualConcessions: number;
  bothWantToConclude: boolean;
  judgeVerdict?: { shouldContinue: boolean; leading?: string };
  totalTokens: number;
  totalCostUsd?: number;
  proposerUsage: AgentUsage;
  challengerUsage: AgentUsage;
}

interface AgentUsage {
  tokens: number;
  costUsd: number;
  // Enhanced metrics for provider-specific tracking
  localTotalChars?: number;        // adapter-local character count
  localTotalUtf8Bytes?: number;    // adapter-local byte count
  previousCumulativeInput?: number; // Codex: baseline for last delta
  lastDeltaInput?: number;          // Codex: most recent input delta
  cacheReadTokens?: number;         // Claude: prompt cache hits
  observedInputPlusCacheRead?: number; // Claude: input + cache for display
}

interface CommandState {
  mode: "normal" | "approval" | "replay";
  pendingApprovals: PendingApproval[];
  replaySpeed?: number;
  replayPaused?: boolean;
}

interface PendingApproval {
  requestId: string;
  adapterId: string;
  approvalType: string;
  title: string;
  suggestion?: "allow" | "deny";
}
```

#### Buffer Management Rules

1. `thinkingText` capped at ~4096 characters — older content trimmed from front
2. `currentMessageText` replaced entirely when `message.final` arrives
3. Only latest `tool.progress` per `toolUseId` kept
4. On `turn.completed`: tools from previous turns collapse to single-line summaries
5. On `round.started` (new round): streaming buffers cleared

### Component Tree

```
<App>
  <HeaderBar />                -- debate title + phase + agents + topic
  <ScrollableContent>          -- displays prebuilt render chunks from the chunk pipeline
  <MetricsBar />               -- per-agent tokens/cost + convergence + judge verdict (3-row box)
  <CommandStatusLine />        -- mode + pending approval count
  <CommandInput />             -- user commands
</App>
```

`App` does not directly compose `SplitPanel`, `AgentPanel`, or `JudgePanel`. Those concepts are rendered indirectly through the chunk pipeline:

`TuiStore` state → `rebuildChunks()` / `populateChunkLines()` → `buildGlobalLineBuffer()` → `ScrollableContent`

Chunk types include round chunks, judge chunks, and summary chunks (including the "Generating final summary and action plan..." state and final output summary).

**Round/judge rendering behavior:**

- Header: status indicator + agent type/model
- Thinking: dimmed italic text, tail window (last N visible lines)
- Tools: latest active tool expanded (input + result), previous tools single-line summary
- Message: streaming text, replaced by final
- On done: duration + status icon
- On error: red banner. Warnings: yellow.

**MetricsBar format** (3-row box):
- Row 1: `Proposer {tokens}({cost}) | Challenger {tokens}({cost}) | Total: {cost}`
- Row 2: `Convergence: [====------] 35% | Judge: {decision} ({leading} leads)`
- Row 3: Status (LIVE/SCROLLED) + scroll position

### CommandInput Modes

**Normal mode:**

- `/inject {role} <text>` — soft guidance into next prompt (priority: normal)
- `/inject both <text>` — soft guidance to both agents
- `/inject! {role|both} <text>` — hard intervention (priority: high, MUST-address directive)
- `/inject judge <text>` — trigger Judge immediately with user instruction
- `/stop` — emit `debate.completed(user-interrupt)`
- `/expand <round>` / `/collapse <round>` — toggle round detail display
- `/top` / `/bottom` — scroll to top/bottom of output

**Approval mode** (auto-activated when approvals pending):

- `/approve [requestId]` — approve (first pending if no ID)
- `/deny [requestId]` — deny

**Parser-only commands not currently wired by the live CLI:**

- `/extend <N>`
- `/pause` / `/resume`

**Replay/parser mode:**

- `/speed <N>` — playback multiplier
- `/jump <N>` or `/jump round <N>` — local round jump
- `/jump turn <turnId>` — parsed, but no current TUI handler

### Persistence (EventStore)

Output files:

- `events.jsonl` — all events, one JSON per line
- `index.json` — unified metadata: byte offsets, segments manifest, config, profiles, versions (no separate `meta.json`). See [EventStore Resume Support](#eventstore-resume-support) for schema.
- `transcript.html` — human-readable HTML (via TranscriptWriter, strips [`debate_meta`](#debatemeta-from-debate_meta-tool)/[`judge_verdict`](#judgeverdict-from-judge_verdict-tool) tool blocks via `stripInternalBlocks()` from orchestrator-core)
- `transcript.md` — plaintext markdown version of the transcript for local inspection (not for programmatic consumption by the synthesizer; the synthesizer uses `TranscriptWriter.getCleanTranscript()` for its clean input)
- `action-plan.html` — primary deliverable: formatted debate action plan ([Action Plan Synthesis](#action-plan-synthesis))
- `action-plan.md` — markdown version of the action plan

**Batch flush strategy:**

- In-memory queue, timer-flushed every 100ms
- Force sync flush on `turn.completed` or `debate.completed` events
- Final flush on `close()`

**index.json schema** (unified — includes both index data and metadata):

```json
{
  "debateId": "d-20260321-143022",
  "topic": "...",
  "startedAt": 1711021822000,
  "endedAt": 1711023456000,
  "totalEvents": 4523,
  "totalRounds": 8,
  "terminationReason": "convergence",
  "roundOffsets": { "1": { "byteOffset": 0, "eventIndex": 1 } },
  "turnOffsets": { "p-1": { "byteOffset": 142, "eventIndex": 2 } },
  "segments": [
    { "file": "events.jsonl", "eventCount": 42, "startedAt": 1711021822000 },
    { "file": "events-resumed-1711001000.jsonl", "eventCount": 18, "startedAt": 1711022800000 }
  ],
  "config": { "topic": "...", "maxRounds": 10, "...": "..." },
  "profiles": {
    "proposer": { "name": "claude/proposer", "agent": "claude_code", "model": "claude-sonnet-4-20250514" },
    "challenger": { "name": "codex/challenger", "agent": "codex" },
    "judge": { "name": "claude/judge", "agent": "claude_code", "model": "claude-sonnet-4-20250514" }
  },
  "versions": { "crossfire": "0.1.0", "nodeVersion": "v24.11.1" }
}
```

`EventStore` records both byte offsets and event indexes. Current replay uses `eventIndex` for fast round jumps after loading segment content into memory. Segments manifest tracks multiple JSONL files across resume sessions. Resume command reads `config` and `profiles` from `index.json` directly.

### Replay

```typescript
async function replayDebate(options: {
  outputDir: string;
  speed?: number; // default 1
  startFromRound?: number; // jump target if index metadata is present
}): Promise<TuiStore>;
```

Loads all JSONL content from the output directory → parses events → creates `ScaledClock` + `ReplayEventSource` → replays into a `TuiStore`. `replayDebate()` does not render [`<App>`](#component-tree); the current CLI replay command is non-interactive.

**Replay timing rules:**

1. First event: delivered immediately (no delta)
2. Near-zero deltas (< 10ms): immediate (covers OrchestratorEvents emitted in quick succession)
3. Normal deltas (>= 10ms): `await clock.delay(deltaMs / speed)`
4. Large deltas (> 5000ms): clamped to 5000ms before speed scaling (prevents stalling)
5. Paused: `delay()` blocks until `resume()` called

**Jump implementation:**

1. Load all segment files listed in `index.json`
2. Look up `roundOffsets[round].eventIndex`
3. Feed all events before that index into `TuiStore` synchronously
4. Resume timed replay from `startFromIndex`

---

## Layer 4: CLI

**Purpose:** Thin wiring shell — no business logic, just assembly. Connects [adapters](#layer-1-adapter-layer), [orchestrator](#layer-2-orchestrator), and [TUI](#layer-3-tui) via three factory functions ([Wiring Modules](#wiring-modules)).

**Package:** `cli` (depends on all other packages, Commander.js ^13, gray-matter ^4, Zod ^3.24)

### Profile System

**Format:** YAML frontmatter + Markdown body

```yaml
---
name: debate_proposer
description: Proposes and defends a position # optional
agent: claude_code # required: claude_code | codex | gemini_cli
model: claude-sonnet-4-20250514 # optional
inherit_global_config: true # default true
mcp_servers: # optional, default {}
  filesystem:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-filesystem"]
    env: {}
---
System prompt body in Markdown.
```

**Zod validation** (`ProfileSchema`):

```typescript
{
  name: z.string(),
  description: z.string().optional(),
  agent: z.enum(["claude_code", "codex", "gemini_cli"]),
  model: z.string().optional(),
  inherit_global_config: z.boolean().default(true),
  mcp_servers: z.record(McpServerSchema).default({}),
}
// McpServerSchema: { command: string, args?: string[], env?: Record<string, string> }
```

**ProfileConfig** extends schema output with `systemPrompt: string` (body) and `filePath: string` (resolved path).

**Search paths:** `./profiles/` then `~/.config/crossfire/profiles/`.

**Model resolution priority:** CLI `--proposer-model` > CLI `--model` > `profile.model` > undefined (provider default).

**Adapter type mapping:** `"claude_code"` → `"claude"`, `"codex"` → `"codex"`, `"gemini_cli"` → `"gemini"`.

### Commands

#### `crossfire start`

```
crossfire start
  --topic <text> | --topic-file <path>     (mutually exclusive, required)
  --proposer <profile>                      (required)
  --challenger <profile>                    (required)
  --judge <profile>                          (default: auto-inferred from proposer's adapter type)
  --max-rounds <n>                          (default: 10, >= 1)
  --judge-every-n-rounds <n>                (default: 3, >= 1 && < max-rounds; periodic judge intervention, adaptive algorithm is fallback only)
  --convergence-threshold <n>               (default: 0.3, ∈ [0,1]; stance distance below which debate auto-converges)
  --output <dir>                            (default: `run_output/${debateId}`)
  --model <model>                           (global override)
  --proposer-model <model>                  (per-role override)
  --challenger-model <model>
  --judge-model <model>
  --headless                                (skip TUI; prints termination reason, round count, and output directory on completion)
  -v, --verbose
```

**Execution flow:**

1. Parse args, validate mutual exclusion (`--topic` vs `--topic-file`)
2. Validate numeric constraints: `maxRounds >= 1`, `convergenceThreshold ∈ [0,1]`, `judgeEveryNRounds >= 1 && < maxRounds`
3. Load profiles via `loadProfile()`, resolve models + adapter types
4. Build `DebateConfig`
5. `mkdirSync(outputDir)`, write `index.json` with config + profile mapping
6. `createAdapters(roles, factories)` → `AdapterBundle`
7. `createBus({ outputDir })` → `BusBundle`
8. `createTui(bus, headless)` → `TuiBundle | null`
9. Register SIGINT handler → push `debate.completed(user-interrupt)`
10. `await runDebate(config, adapters, { bus, transcriptWriter })`
11. `finally`: `busBundle.close()` then `closeAll()`; Ink unmount is handled separately by the command

#### `crossfire resume`

```
crossfire resume <output-dir>
  [--proposer <profile>]     (override, default from index.json)
  [--challenger <profile>]
  [--judge <profile>]        (only honored when the original run had a judge profile)
  [--headless]
```

**Execution flow:**

1. Read `index.json` → get config + original role-to-profile mapping
2. `EventStore.loadSegments(outputDir)` → concatenate all segment files in order
3. `projectState(events)` → rebuild `DebateState`
4. If phase === `"completed"` → print suggestion to use `crossfire replay`, exit 0
5. Resolve profiles (index.json base, CLI overrides)
6. Create a fresh `DebateEventBus`, hydrate it with historical events for runner snapshot state, then wrap it with `createBus({ existingBus, segmentFilename })`
7. Create TUI against that already-hydrated bus
8. `runDebate(config, adapters, { bus, resumeFromState: state, transcriptWriter })`
9. Runner emits `debate.resumed` instead of `debate.started`, calculates `startRound`

#### `crossfire replay`

```
crossfire replay <output-dir> [--speed <n>] [--from-round <n>]
# Validation: --speed > 0, --from-round >= 1
```

Loads events, creates `ScaledClock` + `ReplayEventSource`, starts TUI. No adapters needed.

#### `crossfire status`

```
crossfire status <output-dir> [--json]
```

Reads [`index.json`](#persistence-eventstore) (unified). Displays:

- **Basic info:** debate ID, topic, started/ended timestamps (ISO), duration, total rounds, total events, termination reason (or "in-progress")
- Current implementation always prints `endedAt` and duration fields; the special handling for true in-progress runs is limited to `terminationReason`
- **Segments:** full listing with filename and event count per segment (shown only when 2+ segments exist)
- **Profiles:** proposer/challenger/judge name, agent type, and optional model (objects with `{ name, agent, model? }`)
- **Configuration:** maxRounds, judgeEveryNRounds, convergenceThreshold

`--json` outputs the raw `index.json` content as pretty-printed JSON.

### Wiring Modules

```typescript
// create-adapters.ts
interface AdapterBundle {
  adapters: AdapterMap;
  sessions: SessionMap;
  closeAll(): Promise<void>; // Promise.allSettled, swallows individual errors
}
async function createAdapters(
  roles: ResolvedRoles,
  factories: AdapterFactoryMap,
): Promise<AdapterBundle>;
// On startSession failure: closes already-started adapters before re-throwing

// create-bus.ts
interface BusBundle {
  bus: DebateEventBus;
  eventStore?: EventStore;
  transcriptWriter?: TranscriptWriter; // exposed for runner to call getCleanTranscript()
  close(): Promise<void>;
}
function createBus(options: {
  outputDir?: string;
  segmentFilename?: string;
  existingBus?: DebateEventBus;
}): BusBundle;

// create-tui.ts
interface TuiBundle {
  store: TuiStore;
  source: LiveEventSource;
}
function createTui(bus: DebateEventBus, headless: boolean): TuiBundle | null;
// Returns null when headless; Ink unmounting is handled by the CLI command, not by TuiBundle
```

### Error Handling

| Scenario                            | Behavior                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Profile not found                   | Throw with searched paths + available profiles list                     |
| Profile validation fails            | Throw with file path + Zod error details                                |
| `--topic` + `--topic-file` both set | Commander validation error                                              |
| Numeric validation fails            | Print error with constraint details, exit 1                             |
| Adapter `startSession` fails        | Close already-started adapters, exit 1                                  |
| Adapter crash mid-debate            | `finally` block runs cleanup                                            |
| Resume on completed debate          | Print suggestion to use replay, exit 0                                  |
| Ctrl+C                              | Push `debate.completed(user-interrupt)`, normal cleanup via try/finally |

### EventStore Resume Support

- **Segment convention:** Each resume creates a new JSONL file (e.g., `events-resumed-1711001000.jsonl`) instead of appending to the original.
- **`EventStore` constructor** accepts `segmentFilename` param (default: `"events.jsonl"`).
- **`writeIndex()`** branches by filename: initial write creates fresh `index.json`; resume appends new entry to existing `segments` array.
- **`writeIndex()`** preserves CLI-written metadata (config, profiles, versions) and appends segment metadata, but root-level `totalEvents`, `totalRounds`, `roundOffsets`, and `turnOffsets` describe the most recent write, not an aggregate across all resume segments.
- **`EventStore.loadSegments(dir)`** reads `index.json`, gets `segments` array, loads and concatenates events from all files in order.

---

## Event Flow (End-to-End)

```
Adapter (Claude/Codex/Gemini)
  │ emits NormalizedEvent (message.delta, tool.call, turn.completed, ...)
  ▼
DebateEventBus
  │ merges NormalizedEvent + OrchestratorEvent
  │ notifies all subscribers
  ├──▶ TuiStore.handleEvent() → re-render UI
  ├──▶ EventStore.append() → batch flush to JSONL
  ├──▶ TranscriptWriter.handleEvent() → append to transcript.html
  ├──▶ PlanAccumulator.handleEvent() → local metadata + RoundSignals extraction
  └──▶ Runner reads via bus.snapshot() → DebateDirector.evaluate(state) → DirectorAction
         │ emits OrchestratorEvent (director.action, round.started, judge.started, ...)
         ▼
       (loops back into DebateEventBus)

Post-debate: Runner → synthesis.started
  → computeReferenceScores() → assembleAdaptiveSynthesisPrompt() (4-layer adaptive)
  → runFinalSynthesis() (isolated session) → action-plan.html + action-plan.md
  → synthesis.completed
```

---

## Key Design Decisions

1. **Event sourcing over imperative state** — All state is [`projectState(events[])`](#projection). No mutable accumulation. Enables [replay](#replay), [resume](#crossfire-resume), and debugging by inspecting the event log.

2. **Pure core / effectful shell** — `-core` packages have zero I/O. All file/network/process operations live in outer packages. This makes core logic trivially testable.

3. **Capability-gated interfaces** — `approve?` and `interrupt?` are undefined when unsupported, not no-op stubs. TypeScript enforces checking before calling. Contract tests verify capability consistency.

4. **EventSource abstraction** — TUI components don't know live vs replay. Same [`<App>`](#component-tree) renders both. The [clock and source](#unification-eventsource--playbackclock) are injected.

5. **Segment-based resume** — Each resume creates a new JSONL file instead of appending to the original. The [`index.json`](#persistence-eventstore) `segments` array tracks all files. [`loadSegments()`](#eventstore-resume-support) concatenates them in order.

6. **No facade layer** — CLI directly wires adapters + orchestrator + TUI. Three small [factory functions](#wiring-modules) replace what would be a complex DI container.

7. **Sequential turn-taking** — One agent speaks at a time. The runner awaits `turn.completed` before proceeding. Simpler than parallel execution, matches debate semantics.

8. **Bus injection** — `runDebate()` accepts an external `bus` so TUI, EventStore, and TranscriptWriter can subscribe before the debate starts. If not provided, runner creates one internally.

9. **Graceful degradation** — Judge verdict extraction doesn't crash if the judge skips the tool call. Gemini A→B fallback recovers from resume failures. `closeAll()` uses `Promise.allSettled` to swallow individual cleanup errors.

10. **DebateDirector as pure-logic decision layer** — All "when to do what" logic lives in [`DebateDirector`](#debatedirector) (orchestrator-core), making it testable with crafted state snapshots. [Runner](#runner) is a pure executor. Director evaluates [`DebateState`](#debatestate) → [`DirectorAction`](#directoraction), with zero I/O. [Stagnation detection](#judge-trigger-strategy-7-sources), [degradation treatment](#repetition-degradation-treatment-2-layers), adaptive Judge scheduling, and [clarification flow](#clarification-flow) are all Director responsibilities.

11. **Mandatory `director.action` events** — Every Director evaluation is persisted as a `director.action` event in JSONL. This provides an audit trail and enables meaningful replay — without it, replay cannot explain why Judge was triggered or why debate ended early.

12. **Bounded incremental debate prompts** — Debate turns use the [Context Builder](#context-builder-incremental-prompt-system), not full-transcript prompt replay. Turn 1 sends the full system/topic/schema payload; later turns send incremental opponent/judge context plus schema reminders. Long-term debate memory lives in [`DebateState`](#debatestate), while provider-native session memory handles recent conversational context. This prevents O(n²) token growth in providers with persistent threads (Codex) and keeps per-turn prompt size roughly bounded.

13. **Adaptive synthesis via isolated session** — The primary deliverable (`action-plan.html`) is generated by a [4-layer adaptive prompt system](#4-layer-adaptive-synthesis-prompt) that replaces hard truncation. `assembleAdaptiveSynthesisPrompt()` selects budget tier (short/medium/long), scores rounds via Tier-1 signals + Tier-2 reference centrality, promotes critical rounds to full text, compresses the rest to Layer 2, and adds Layer 4 quote snippets — all within the context budget via a 6-step iterative shrink. A new, isolated adapter session (not the debate session) sends the assembled prompt. [Three-tier quality fallback](#three-quality-tiers) (LLM-full → local-structured → local-degraded) ensures output is always produced. Clean transcript data comes from `TranscriptWriter.getCleanTranscript()`, exposed via `BusBundle.transcriptWriter`.

---

## File Layout

```
crossfire/
├── packages/
│   ├── adapter-core/        # Types, Zod schemas, contract test framework
│   ├── adapter-claude/      # Claude Agent SDK wrapper
│   ├── adapter-codex/       # Codex JSON-RPC stdio wrapper
│   ├── adapter-gemini/      # Gemini subprocess + resume manager
│   ├── orchestrator-core/   # Pure: types, projection, convergence, meta-tool, context-builder, debate-memory, director/, evolving-plan, synthesis-prompt, strip-internal-blocks, markdown-renderer
│   ├── orchestrator/        # Effects: runner, judge, event-bus, event-store, transcript-writer, final-synthesis, plan-accumulator
│   ├── tui/                 # Ink components, TuiStore, EventSource, PlaybackClock, replay
│   └── cli/                 # Commander.js entry, profile system, wiring factories
├── profiles/                # YAML frontmatter debate role profiles
├── docs/
│   └── architecture.md      # This file
├── turbo.json               # Build orchestration (dependsOn: ^build)
├── tsconfig.base.json       # Shared TypeScript config
├── vitest.config.ts         # Test config (workspace mode)
└── biome.json               # Lint + format config
```

## Testing Strategy

| Layer       | What                                                                                                        | How                                                                    | Gate                |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| Unit        | Pure functions (projection, convergence, event mappers, Zod schemas, prompt builders)                       | Direct assertions, no mocks                                            | Always              |
| Contract    | Adapter interface compliance (9 categories)                                                                 | Shared `runContractTests()` + `MockAdapterFactory` + `ScenarioFixture` | Always              |
| Director    | DebateDirector, JudgePolicy, StagnationDetector, DegradationDetector, ClarificationPolicy, SummaryGenerator | Crafted DebateState snapshots, signal detection assertions             | Always              |
| Synthesis   | 4-layer adaptive assembly, budget tiers, round scoring, reference scoring, quote snippets, shrink algorithm, phase blocks, golden prompts, markdown→HTML rendering, fallback template quality | Direct assertions on pure functions; mock adapter for `runFinalSynthesis` | Always            |
| TUI         | Store projection, buffer management, component rendering                                                    | Scripted events + `ink-testing-library`                                | Always              |
| Wiring      | CLI factories (createAdapters, createBus, createTui)                                                        | Mock adapters                                                          | Always              |
| Integration | Real adapter + orchestrator + Director round-trips                                                          | Env-gated matrix; `RUN_INTEGRATION=1` enables the base suite, `HAVE_CODEX` and `HAVE_GEMINI` expand provider combinations | `RUN_INTEGRATION=1` |

Total: ~918 unit/contract tests + Director tests + integration tests (skipped by default without `RUN_INTEGRATION=1`).
