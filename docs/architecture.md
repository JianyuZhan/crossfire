# Crossfire Architecture

> AI agent adversarial debate orchestrator — a pure TypeScript pnpm monorepo.

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

**Purpose:** Normalize three vastly different AI agent protocols into a single `NormalizedEvent` stream.

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

- **`sendTurn()`** resolves once the turn is accepted and streaming begins — NOT when the turn finishes. Turn completion is signaled exclusively via the `turn.completed` event.
- **`onEvent()`** delivers events from ALL sessions managed by the adapter instance. Consumers filter on `adapterSessionId`. The returned function unsubscribes entirely.
- **`approve()`/`interrupt()`** are `undefined` (not no-op stubs) when the adapter's capabilities don't support them. Calling when undefined throws `AdapterError`.
- **`close()`** stops event emission for that session. There is no `session.closed` event — close is imperative, not observable.
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
  providerSessionId?: string; // provider-native, initially undefined
}
```

| Category       | Kinds                                       | Notable Fields                                                |
| -------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Session        | `session.started`                           | `providerSessionId` (always set at emission)                  |
| Text           | `message.delta`, `message.final`            | `text`, `stopReason?` (on final)                              |
| Thinking       | `thinking.delta`                            | `text`, `thinkingType: "raw-thinking" \| "reasoning-summary"` |
| Plan           | `plan.updated`                              | `steps` (Codex-specific)                                      |
| Tools          | `tool.call`, `tool.progress`, `tool.result` | `toolUseId`, `toolName`, `input`/`output`                     |
| Approvals      | `approval.request`, `approval.resolved`     | `suggestion?: "allow" \| "deny"`                              |
| Subagents      | `subagent.started`, `subagent.completed`    | subagent lifecycle                                            |
| Metrics        | `usage.updated`                             | `inputTokens`, `outputTokens`, `totalCostUsd?`                |
| Turn lifecycle | `turn.completed`                            | `status`, `durationMs`, `usage?`                              |
| Errors         | `run.error`, `run.warning`                  | `message`                                                     |

`turn.completed.status`: `"completed" | "interrupted" | "failed" | "timeout"`

### AdapterCapabilities

11-field capability detection:

- Resume: `resumeMode` (`"protocol-native" | "native-cli" | "stateless"`), `resumeStability`
- `supportsExternalHistory`, `supportsRawThinking`, `supportsReasoningSummary`
- `supportsPlan`, `supportsApproval`, `supportsInterrupt`, `supportsSubagents`
- `supportsStreamingDelta`

Contract tests enforce: if `supportsApproval=false`, adapter never emits `approval.*` events. Same for plan, subagents.

### SessionHandle

```typescript
interface SessionHandle {
  adapterSessionId: string;
  providerSessionId: string | undefined; // set timing varies by adapter
  adapterId: "claude" | "codex" | "gemini";
}
```

### StartSessionInput

```typescript
interface StartSessionInput {
  profile: string;
  workingDirectory: string;
  model?: string;
  mcpServers?: Record<string, McpServerConfig>;
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
- **Approval:** `canUseTool` callback returns `PermissionResult` (allow with optional `updatedInput`, or deny with optional message/interrupt).
- **Hooks** (uppercase names): `PreToolUse` → `tool.call`, `PostToolUse` → `tool.result` (success), `PostToolUseFailure` → `tool.result` (error), `SubagentStart`/`SubagentStop` → `subagent.*` events.
- **`interrupt()`** uses `Query.interrupt()`.
- **`close()`** clears that session's query context only, not global listeners.

#### Codex Adapter

- **Transport:** Subprocess + bidirectional JSON-RPC 2.0 over stdio JSONL. Fixed to `--listen stdio://`.
- **`startSession()`**: `initialize` → `initialized` notification → `thread/start` with `{ model, cwd, approvalPolicy }` → returns `{ thread: { id } }` as `providerSessionId`.
- **`sendTurn()`**: `turn/start` with `{ threadId, input: [{ type: "text", text }] }` → returns `{ turn: { id, status } }`.
- **Approval:** JSON-RPC request-response. Server sends `requestApproval`, adapter emits `approval.request`, orchestrator calls `approve()`, adapter sends JSON-RPC response back.
- **`interrupt()`**: `turn/interrupt` method.
- **Plan:** `turn/plan/updated` notification → `plan.updated` event.
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
  - **Fallback triggers:** non-zero exit with no init event, `session_id` mismatch in init, process crash during resume
  - Fallback emits `run.warning` explaining the switch
- **Turn-local state machine** (`TurnRuntimeState`): tracks `completed`, `fallbackTriggered`, `intentionalKill`, `resultSeen`. Ensures exactly ONE `turn.completed` per turn. Killing process for fallback sets `intentionalKill=true` so the exit handler ignores it.

### Contract Tests

Shared `runContractTests()` matrix with provider-specific mock factories:

| Category                     | What it tests                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Happy path                   | `session.started` exactly once, `turn.completed` exactly once per turn, usage carried                 |
| Multi-turn                   | Second turn works, no duplicate `session.started`                                                     |
| Tool lifecycle               | `tool.call` → `tool.progress` → `tool.result` ordering                                                |
| Tool failure                 | `tool.result` with error                                                                              |
| Approval (capability-gated)  | `approval.request` → `approve()` → `approval.resolved`                                                |
| Interrupt (capability-gated) | Interrupt → exactly one `turn.completed` with `status: "interrupted"`                                 |
| Resource cleanup             | close stops event emission, subprocess cleanup                                                        |
| Event ordering               | `tool.call` before `tool.result`, `turn.completed` is terminal                                        |
| Capability consistency       | `assertCapabilitiesConsistent(events, capabilities)` — e.g., `supportsPlan=false` → no `plan.updated` |

**`waitForTurnCompleted()`** matches by `turnId` to prevent cross-turn false matches.

**Integration tests** (gated by `RUN_INTEGRATION=1`): real adapters, cheapest models. Pre-checks: verify `which codex` / `which gemini` + version compatibility.

---

## Layer 2: Orchestrator

**Purpose:** Event-sourced debate loop — emit events, project state, make decisions.

**Packages:** `orchestrator-core` (pure logic + DebateDirector), `orchestrator` (side effects)

### Core Types

#### DebateConfig

```typescript
interface DebateConfig {
  topic: string;
  maxRounds: number;
  judgeEveryNRounds: number; // 0 = no judge
  convergenceThreshold: number; // 0-1
  proposerModel?: string;
  challengerModel?: string;
  judgeModel?: string;
}
```

#### OrchestratorEvent (12 types)

| Kind                      | Key Fields                                            |
| ------------------------- | ----------------------------------------------------- |
| `debate.started`          | `config: DebateConfig`                                |
| `debate.resumed`          | `fromRound: number`                                   |
| `round.started`           | `roundNumber`, `speaker: "proposer" \| "challenger"`  |
| `round.completed`         | `roundNumber`, `speaker`                              |
| `judge.started`           | `roundNumber`                                         |
| `judge.completed`         | `roundNumber`, `verdict: JudgeVerdict`                |
| `debate.completed`        | `reason: TerminationReason`                           |
| `prompt.stats`            | `roundNumber`, `speaker`, `promptChars`               |
| `user.inject`             | `target`, `text`, `priority: "normal" \| "high"`      |
| `clarification.requested` | `source`, `question`, `judgeComment?`                 |
| `clarification.provided`  | `answer`, `answeredBy: "user" \| "judge"`             |
| `director.action`         | `action: DirectorAction`, `signals: DirectorSignal[]` |

The last 5 events (`user.inject` through `director.action`) are informational for audit/replay. State changes are driven by the actions they describe (e.g., `round.started`, `judge.started`). `director.action` is **mandatory and persisted** to JSONL — it enables meaningful replay explaining why Judge was triggered, why debate ended, or why guidance was injected.

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
  content: string; // aggregated from message.final
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
  requestIntervention?: {          // NEW: agent requests clarification/arbitration
    type: "clarification" | "arbitration";
    question: string;
  };
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

Both tools defined as Zod schemas. Adapter `tool.call` events with these tool names flow through the bus; projection extracts structured data via Zod parse.

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

`checkConvergence(state)` computes: stance delta (mapped to 0-4 scale) + mutual concessions count + both `wantsToConclude` flags → percentage that the runner compares against `convergenceThreshold`. Enhanced with single-party convergence detection: when one side has `wantsToConclude` for 2+ rounds with confidence >= 0.9, this signals Director to trigger Judge arbitration (NOT direct termination).

### Projection

```typescript
function projectState(events: AnyEvent[]): DebateState;
// AnyEvent = NormalizedEvent | OrchestratorEvent
```

Pure reducer: processes events in order, deterministic replay guarantee. Unknown event kinds ignored (forward compatibility). `message.final` → turn content, `tool.call` with debate_meta/judge_verdict → structured extraction.

### DebateDirector

Pure-logic layer in `orchestrator-core` that manages all "when to do what" decisions. Extracts decision logic from `runner.ts` so the runner becomes a pure executor.

```
DebateDirector (orchestrator-core, pure logic, zero I/O)
├── evaluate(state) -> DirectorAction
├── getGuidance(role) -> string | undefined
├── storeGuidance(target, text, priority, source)
│
├── JudgePolicy            When to trigger Judge (6 trigger sources)
├── StagnationDetector     Both-sides-stuck detection
├── DegradationDetector    Single-side quality degradation detection
├── ClarificationPolicy    await-user whitelist filter
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
  | "agent-request"
  | "user"
  | "final-review";
```

**Action priority** (highest wins when multiple signals fire): `end-debate > await-user > trigger-judge > inject-guidance > continue`

#### Judge Trigger Strategy (6 Sources)

| Source                 | Condition                                                                                                      | Action                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Adaptive scheduled** | After >= minRound, by total-round proportion (~30% first, ~25% subsequent); mandatory before penultimate round | `trigger-judge { reason: "scheduled" }`     |
| **Stagnation**         | Stance delta unchanged >= 2 rounds + one side wantsToConclude while other refuses                              | `trigger-judge { reason: "stagnation" }`    |
| **Degradation**        | key_points overlap > 70% for 2+ rounds; first fires inject-guidance, then Judge                                | `trigger-judge { reason: "degradation" }`   |
| **Agent request**      | `debate_meta.request_intervention` → ClarificationPolicy filters                                               | `trigger-judge { reason: "agent-request" }` |
| **User**               | `/inject judge <instruction>` — triggers Judge immediately                                                     | `trigger-judge { reason: "user" }`          |
| **Final review**       | Debate ending (any reason), before `debate.completed`                                                          | `trigger-judge { reason: "final-review" }`  |

#### Convergence Rules (Enhanced)

| Signal                                                         | Effect                                        |
| -------------------------------------------------------------- | --------------------------------------------- |
| `bothWantToConclude` = true                                    | → `end-debate { reason: "convergence" }`      |
| `stanceDelta <= threshold`                                     | → `end-debate { reason: "convergence" }`      |
| Single-party `wantsToConclude` >= 2 rounds + confidence >= 0.9 | → `trigger-judge` (NOT end-debate)            |
| Judge verdict `shouldContinue: false`                          | → `end-debate { reason: "judge-decision" }`   |
| Stagnation >= 3 rounds AND Judge intervened >= 2 times         | → `end-debate { reason: "stagnation-limit" }` |

#### Repetition Degradation Treatment (3 Layers)

| Layer              | Trigger                                       | Behavior                                                                      |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| **Prompt layer**   | key_points overlap > 50%                      | Static anti-repetition reminder in prompt                                     |
| **Director layer** | DegradationDetector: overlap > 70%, 2+ rounds | Active `inject-guidance` with specific instructions to shift argument         |
| **Judge layer**    | Guidance issued but still degraded            | `trigger-judge { reason: "degradation" }`, verdict includes `repetitionScore` |

#### Clarification Flow

```
Agent meta: request_intervention { type, question }
  → ClarificationPolicy.evaluate()
  → Matches whitelist? → trigger-judge { reason: "agent-request" }
    → Judge evaluates
      → Judge answers directly → clarification.provided { answeredBy: "judge" }
      → Judge relays → clarification.requested → TUI blocks → user answers
        → clarification.provided { answeredBy: "user" } → injected into both agents' next prompt
```

**Critical rule**: Director NEVER directly emits `await-user`. All agent clarification requests go through Judge first. (v1: `await-user` is only produced by the Runner when Judge relays a clarification. The type is retained in `DirectorAction` for future extensibility.)

#### `/inject` Command System

```
/inject proposer <text>          soft guidance, priority: normal
/inject challenger <text>        soft guidance, priority: normal
/inject both <text>              soft guidance to both sides
/inject! proposer <text>         hard intervention, priority: high
/inject! both <text>             hard intervention to both sides
/inject judge <text>             directly trigger Judge with user instruction
```

All injections are **one-shot** — consumed when the target role's next `round.started` fires.

#### Debate End Flow (Final Outcome)

```
1. Main loop exits (max-rounds / convergence / judge-decision / stagnation-limit)
2. trigger-judge { reason: "final-review" }  — Judge final verdict (if available)
3. SummaryGenerator produces structured summary
4. Final Outcome block written to transcript tail + summary.json to output dir
5. debate.completed event pushed  — TRUE TERMINAL EVENT
```

`debate.completed` is pushed LAST, after all wrap-up. Final Outcome block is always generated — `summary.json` has a consistent schema: if the final-review Judge returns a verdict, SummaryGenerator incorporates it (leading side, score, reasoning); if Judge is unavailable or fails, Judge-sourced fields are set to `null`.

#### Director File Layout

```
orchestrator-core/src/director/
  types.ts                -- DirectorAction, TriggerJudgeReason, Signal types, DirectorConfig
  debate-director.ts      -- Main: evaluate() + getGuidance() + storeGuidance()
  judge-policy.ts         -- Adaptive Judge trigger logic (6 sources)
  stagnation-detector.ts  -- Both-sides-stuck detection (stance-frozen, one-sided-conclude)
  degradation-detector.ts -- Single-side key-point repetition detection
  clarification-policy.ts -- Whitelist filter for await-user requests
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

Merges both `NormalizedEvent` and `OrchestratorEvent` streams. All consumers (TUI, EventStore, TranscriptWriter, Runner) subscribe here.

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
  judge?: { adapter: AgentAdapter; session: SessionHandle }; // optional for --judge none
}

interface RunDebateOptions {
  bus?: DebateEventBus; // injectable, otherwise created internally
  resumeFromState?: DebateState; // skip completed rounds on resume
}
```

**Main loop** (Director-driven):

1. Wire adapter `onEvent` callbacks into `bus.push()`
2. Create `DebateDirector` instance with `DirectorConfig`
3. Emit `debate.started` (or `debate.resumed` with `fromRound` if resuming)
4. Loop while not terminated:
   - **Proposer turn:** `director.getGuidance("proposer")` → `buildTurnPrompt(state, "proposer", { guidance })` → emit `prompt.stats` → `adapter.sendTurn()` → wait for `turn.completed`
   - **Challenger turn:** same pattern (also emits `prompt.stats`)
   - **Director evaluates:** `director.evaluate(bus.snapshot())` → push `director.action` event
   - **Execute action:** `end-debate` → break to Final Outcome; `trigger-judge` → run Judge turn; `inject-guidance` → store for next turn; `await-user` → block for clarification; `continue` → next round
5. **Final Outcome flow:** optional `trigger-judge { reason: "final-review" }` → `SummaryGenerator` → write Final Outcome to transcript + `summary.json` → emit `debate.completed` as **last** event

`waitForTurnCompleted()` listens on bus (not directly on adapters), matching by `turnId`.

### Context Builder (Bounded Session Memory)

The prompt system uses a **4-layer architecture** with bounded token usage, eliminating O(n²) growth in provider threads. Core principle: **provider context = short-term working memory; DebateState = long-term fact memory.**

#### 4-Layer Prompt Structure

```
Layer 1: Stable Prefix      (~10%)  topic, role, rules, language, meta-tool format
Layer 2: Long-term Memory    (~35%)  structured data from DebateState
Layer 3: Local Window        (~35%)  opponent last turn (truncated) + self summary
Layer 4: Turn Instructions   (~20%)  objective, conclude/continue, output format
```

Layers 2–3 gracefully degrade to empty when no history exists (e.g., Round 1 proposer).

#### Two-Stage Pipeline

Internally, prompt construction is split into extraction and rendering (`buildPromptContext` → `renderTurnPrompt`). The renderers are private; the public API provides both extraction functions (for testing/inspection) and end-to-end wrappers:

- **`buildPromptContext(state, role, options?)`** → `PromptContext` — extraction only (public)
- **`buildTurnPromptFromState(state, role, options?)`** → `string` — extraction + rendering (public)
- **`buildTurnPrompt(state, role, options?)`** → `string` — backward-compatible alias for `buildTurnPromptFromState` (public)
- **`buildJudgePromptContext(state, options?)`** → `JudgePromptContext` — extraction only (public)
- **`buildJudgePrompt(state)`** → `string` — extraction + rendering for judge (public)

#### PromptContext

```typescript
interface PromptContext {
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
    selfKeyPoints: string[]; // max 12, each truncate(160)
    opponentKeyPoints: string[]; // max 12, each truncate(160)
    selfConcessions: string[]; // max 8, each truncate(160)
    opponentConcessions: string[]; // max 8, each truncate(160)
    unresolvedIssues: string[]; // max 10, each truncate(160)
    judgeSummary?: string; // truncate(300), most recent verdict
    directorGuidance?: string[]; // max 3 items
    userInjection?: { text: string; priority: "normal" | "high" };
  };

  localWindow: {
    opponentLastTurnFull?: string; // normalizeWhitespace + truncateWithHeadTail(1500)
    selfLastTurnSummary?: string; // truncate(keyPoints.join("; "), 500) or truncate(content, 300)
  };

  controls: {
    shouldTryToConclude: boolean;
    repetitionWarnings?: string[];
  };
}
```

**Field extraction rules:**

- **Stance/confidence:** from own/opponent latest turn `meta.stance`, `meta.confidence`
- **keyPoints/concessions:** flatMap across ALL turns, deduplicated (later rounds take priority when over limit)
- **unresolvedIssues:** latest completed round keyPoints (currentRound - 1 when > 1) filtered through `filterUnresolved()` (from `debate-memory.ts`)
- **judgeSummary:** iterate turns backward, first `judgeVerdict.reasoning` found, `truncate(300)`
- **Null safety:** always `t.meta?.keyPoints ?? []`, `t.meta?.concessions ?? []`

#### JudgePromptContext

```typescript
interface JudgePromptContext {
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
  previousJudgeSummary?: string; // truncate(300)
  proposerLastTurn?: string; // truncateWithHeadTail(1500)
  challengerLastTurn?: string; // truncateWithHeadTail(1500)
  earlyEndGuidance: string;
}
```

Key difference from old design: Judge prompt uses **structured summary + latest round content only**, NOT full transcript. Prompt size is roughly constant regardless of round count.

#### Utility Functions

| Function                 | Location             | Purpose                                                                                      |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------- |
| `truncate(text, max)`    | `context-builder.ts` | Simple end truncation with `"..."` suffix                                                    |
| `normalizeWhitespace(t)` | `context-builder.ts` | Collapse 3+ newlines → 2, 2+ spaces → 1, trim                                                |
| `truncateWithHeadTail()` | `context-builder.ts` | Head 60% + tail 40% of space after `[...truncated...]` marker; guard for very small maxChars |
| `isAcknowledged()`       | `debate-memory.ts`   | Substring overlap on first 20 chars (case-insensitive)                                       |
| `filterUnresolved()`     | `debate-memory.ts`   | Key points minus acknowledged concessions, deduped                                           |

#### Shared Utility: `debate-memory.ts`

Extracts the unresolved-issue matching heuristic into a neutral module. Both `context-builder.ts` and `summary-generator.ts` import from here (neither depends on the other).

```
debate-memory.ts  (shared, zero dependencies on other orchestrator-core modules)
  ↑               ↑
  │               │
context-builder.ts   summary-generator.ts
```

#### Length Budget

| Layer     | Content                             | Proposer/Challenger | Judge             |
| --------- | ----------------------------------- | ------------------- | ----------------- |
| 1         | Topic + role + rules + language     | 300–500 chars       | 200–400 chars     |
| 2         | Long-term memory (structured)       | 800–1,500 chars     | 800–1,500 chars   |
| 3         | Local window / recent round content | 1,500–2,000 chars   | 2,000–3,000 chars |
| 4         | Objective + output format           | 400–600 chars       | 300–500 chars     |
| **Total** |                                     | **~3,000–4,600**    | **~3,300–5,400**  |

#### Provider Strategy

| Provider | Session/Thread        | Prompt Strategy                                        | Phase 2 (future)                   |
| -------- | --------------------- | ------------------------------------------------------ | ---------------------------------- |
| Claude   | Keep session (resume) | 4-layer structured prompt; rely on SDK compaction      | Monitor; may need compact boundary |
| Codex    | Keep thread           | 4-layer structured prompt; no full history in prompt   | Compact/rotate at threshold        |
| Gemini   | Stateless per-turn    | 4-layer structured prompt; summary provides continuity | N/A (already stateless)            |

All providers receive the same structured prompt. Semantic contract: **model handles short-term coherence, system handles long-term memory.**

#### TurnPromptOptions (Compatibility)

```typescript
interface TurnPromptOptions {
  guidance?: string; // from DebateDirector.getGuidance(), string → [string] internally
  userInjection?: { text: string; priority: "normal" | "high" };
  shouldTryToConclude?: boolean;
  repetitionWarnings?: string[];
}
```

The old `clarifications` field is removed — superseded by `directorGuidance` and `userInjection`.

### Judge Turn

`runJudgeTurn()` — verdict extraction with graceful degradation. If judge doesn't call the `judge_verdict` tool, the runner continues without a verdict rather than crashing.

---

## Layer 3: TUI

**Purpose:** Event-driven terminal UI for live rendering and replay, powered by Ink (React for CLI).

**Package:** `tui` (depends on adapter-core, orchestrator-core, ink, react)

### Unification: EventSource + PlaybackClock

The TUI doesn't know if it's live or replay — it consumes events from an `EventSource`:

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

Lightweight projection from raw events into render-ready state. Prevents excessive re-renders from high-frequency `thinking.delta`/`message.delta`.

```typescript
interface TuiState {
  proposer: LiveAgentPanelState;
  challenger: LiveAgentPanelState;
  judge: JudgeStripState;
  metrics: MetricsState;
  command: CommandState;
  debateState: DebateState; // full projected state
}
```

#### LiveAgentPanelState

```typescript
interface LiveAgentPanelState {
  role: "proposer" | "challenger";
  model?: string;
  status: "idle" | "thinking" | "tool" | "speaking" | "done" | "error";
  thinkingText: string; // 4KB buffer, front-trimmed
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
  judgeScore?: { proposer: number; challenger: number };
  totalTokens: number;
  totalCostUsd: number;
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

1. `thinkingText` capped at 4KB — older content trimmed from front
2. `currentMessageText` replaced entirely when `message.final` arrives
3. Only latest `tool.progress` per `toolUseId` kept
4. On `turn.completed`: tools from previous turns collapse to single-line summaries
5. On `round.started` (new round): streaming buffers cleared

### Component Tree

```
<App>
  <StatusBar />              -- debate title + phase
  <SplitPanel>
    <AgentPanel role="proposer" />
    <AgentPanel role="challenger" />
  </SplitPanel>
  <JudgePanel />             -- visible during judge phase
  <MetricsBar />             -- round/convergence/stance/tokens
  <CommandStatusLine />      -- mode + pending approval count
  <CommandInput />           -- user commands
</App>
```

**AgentPanel rendering:**

- Header: status indicator + model name
- Thinking: dimmed italic text, tail window (last N visible lines)
- Tools: latest active tool expanded (input + result), previous tools single-line summary
- Message: streaming text, replaced by final
- On done: duration + status icon
- On error: red banner. Warnings: yellow.

**MetricsBar format:**
`Round 2/10 | Conv: [====------] 35% | P[agree 0.8] <-> C[disagree 0.7] d=0.45 | Concessions: 2 | Judge: P7:C5 | Tokens: 12.4k | $0.23`

### CommandInput Modes

**Normal mode:**

- `/inject {role} <text>` — soft guidance into next prompt (priority: normal)
- `/inject both <text>` — soft guidance to both agents
- `/inject! {role|both} <text>` — hard intervention (priority: high, MUST-address directive)
- `/inject judge <text>` — trigger Judge immediately with user instruction
- `/extend <N>` — increase max rounds
- `/pause` / `/resume` — debate flow control
- `/stop` — emit `debate.completed(user-interrupt)`

**Approval mode** (auto-activated when approvals pending):

- `/approve [requestId]` — approve (first pending if no ID)
- `/deny [requestId]` — deny

**Replay mode:**

- `/speed <N>` — playback multiplier
- `/pause` / `/resume`
- `/jump round <N>` — seek via index offsets
- `/jump turn <turnId>`

### Persistence (EventStore)

Output files:

- `events.jsonl` — all events, one JSON per line
- `index.json` — metadata + byte offsets + segments manifest
- `meta.json` — config + profile mapping + versions
- `transcript.md` — human-readable Markdown (via TranscriptWriter)
- `summary.json` — structured debate summary (generated by SummaryGenerator at debate end)

**Batch flush strategy:**

- In-memory queue, timer-flushed every 100ms
- Force sync flush on `turn.completed` or `debate.completed` events
- Final flush on `close()`

**index.json schema:**

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
    { "file": "events.jsonl", "eventCount": 42 },
    { "file": "events-resumed-1711001000.jsonl", "eventCount": 18 }
  ]
}
```

Byte offsets enable fast seeking for replay jump. Segments manifest tracks multiple JSONL files across resume sessions.

**meta.json schema:**

```json
{
  "config": { "topic": "...", "maxRounds": 10, "...": "..." },
  "profiles": {
    "proposer": "debate_proposer",
    "challenger": "debate_challenger",
    "judge": "none"
  },
  "versions": { "crossfire": "0.1.0", "nodeVersion": "v24.11.1" }
}
```

### Replay

```typescript
async function replayDebate(options: {
  eventsPath: string;
  speed?: number; // default 1
  startFromRound?: number; // instant seek via index
}): Promise<void>;
```

Loads events → creates `ScaledClock` + `ReplayEventSource` → starts same `<App>` component. TUI code is identical for live and replay.

**Replay timing rules:**

1. First event: delivered immediately (no delta)
2. Near-zero deltas (< 10ms): immediate (covers OrchestratorEvents emitted in quick succession)
3. Normal deltas (>= 10ms): `await clock.delay(deltaMs / speed)`
4. Large deltas (> 5000ms): clamped to 5000ms before speed scaling (prevents stalling)
5. Paused: `delay()` blocks until `resume()` called

**Jump implementation:**

1. Read byte offset from `index.json` for target round
2. Seek to offset in JSONL, load all events up to target synchronously
3. Instant state reconstruction via `projectState(events)`
4. Resume timed replay from that point

---

## Layer 4: CLI

**Purpose:** Thin wiring shell — no business logic, just assembly.

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
  --judge <profile|"none">                  (default: "none")
  --max-rounds <n>                          (default: 10)
  --judge-every-n-rounds <n>                (default: 3)
  --convergence-threshold <n>               (default: 0.3)
  --output <dir>                            (default: run_output/debate-{timestamp})
  --model <model>                           (global override)
  --proposer-model <model>                  (per-role override)
  --challenger-model <model>
  --judge-model <model>
  --headless                                (skip TUI, default: false)
  -v, --verbose
```

**Execution flow:**

1. Parse args, validate mutual exclusion (`--topic` vs `--topic-file`)
2. If `--judge none`: force `judgeEveryNRounds = 0`, reject `--judge-model`
3. Load profiles via `loadProfile()`, resolve models + adapter types
4. Build `DebateConfig`
5. `mkdirSync(outputDir)`, write `meta.json` with config + profile mapping
6. `createAdapters(roles, factories)` → `AdapterBundle`
7. `createBus({ outputDir })` → `BusBundle`
8. `createTui(bus, headless)` → `TuiBundle | null`
9. Register SIGINT handler → push `debate.completed(user-interrupt)`
10. `await runDebate(config, adapters, { bus })`
11. `finally`: `closeAll()`, `busBundle.close()`, `tuiBundle?.unmount()`

#### `crossfire resume`

```
crossfire resume <output-dir>
  [--proposer <profile>]     (override, default from meta.json)
  [--challenger <profile>]
  [--judge <profile>]
  [--headless]
```

**Execution flow:**

1. Read `meta.json` → get config + original role-to-profile mapping
2. `EventStore.loadSegments(outputDir)` → concatenate all segment files in order
3. `projectState(events)` → rebuild `DebateState`
4. If phase === `"completed"` → print suggestion to use `crossfire replay`, exit 0
5. Resolve profiles (meta.json base, CLI overrides)
6. Create new bus + EventStore with `segmentFilename: "events-resumed-{timestamp}.jsonl"`
7. Feed existing events into bus (for TUI subscribers to catch up)
8. `runDebate(config, adapters, { bus, resumeFromState: state })`
9. Runner emits `debate.resumed` instead of `debate.started`, calculates `startRound`

#### `crossfire replay`

```
crossfire replay <output-dir> [--speed <n>] [--from-round <n>]
```

Loads events, creates `ScaledClock` + `ReplayEventSource`, starts TUI. No adapters needed.

#### `crossfire status`

```
crossfire status <output-dir> [--json]
```

Reads `index.json` + `meta.json`. Displays debate ID, topic, rounds completed/total, event count, duration, termination reason, segment count. `--json` for raw output.

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
  close(): Promise<void>;
}
function createBus(options: {
  outputDir?: string;
  segmentFilename?: string;
}): BusBundle;

// create-tui.ts
interface TuiBundle {
  store: TuiStore;
  source: LiveEventSource;
  unmount: () => void;
}
function createTui(bus: DebateEventBus, headless: boolean): TuiBundle | null;
// Returns null when headless
```

### Error Handling

| Scenario                            | Behavior                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Profile not found                   | Throw with searched paths + available profiles list                     |
| Profile validation fails            | Throw with file path + Zod error details                                |
| `--topic` + `--topic-file` both set | Commander validation error                                              |
| `--judge none` + `--judge-model`    | Print error, exit 1                                                     |
| Adapter `startSession` fails        | Close already-started adapters, exit 1                                  |
| Adapter crash mid-debate            | `finally` block runs cleanup                                            |
| Resume on completed debate          | Print suggestion to use replay, exit 0                                  |
| Ctrl+C                              | Push `debate.completed(user-interrupt)`, normal cleanup via try/finally |

### EventStore Resume Support

- **Segment convention:** Each resume creates a new JSONL file (e.g., `events-resumed-1711001000.jsonl`) instead of appending to the original.
- **`EventStore` constructor** accepts `segmentFilename` param (default: `"events.jsonl"`).
- **`writeIndex()`** branches by filename: initial write creates fresh `index.json`; resume appends new entry to existing `segments` array.
- **`writeMeta()`** merges with existing `meta.json` if present (preserves profiles mapping written by CLI).
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
  ├──▶ TranscriptWriter.handleEvent() → append to transcript.md
  └──▶ Runner reads via bus.snapshot() → DebateDirector.evaluate(state) → DirectorAction
         │ emits OrchestratorEvent (director.action, round.started, judge.started, ...)
         ▼
       (loops back into DebateEventBus)
```

---

## Key Design Decisions

1. **Event sourcing over imperative state** — All state is `projectState(events[])`. No mutable accumulation. Enables replay, resume, and debugging by inspecting the event log.

2. **Pure core / effectful shell** — `-core` packages have zero I/O. All file/network/process operations live in outer packages. This makes core logic trivially testable.

3. **Capability-gated interfaces** — `approve?` and `interrupt?` are undefined when unsupported, not no-op stubs. TypeScript enforces checking before calling. Contract tests verify capability consistency.

4. **EventSource abstraction** — TUI components don't know live vs replay. Same `<App>` renders both. The clock and source are injected.

5. **Segment-based resume** — Each resume creates a new JSONL file instead of appending to the original. The index.json `segments` array tracks all files. `loadSegments()` concatenates them in order.

6. **No facade layer** — CLI directly wires adapters + orchestrator + TUI. Three small factory functions replace what would be a complex DI container.

7. **Sequential turn-taking** — One agent speaks at a time. The runner awaits `turn.completed` before proceeding. Simpler than parallel execution, matches debate semantics.

8. **Bus injection** — `runDebate()` accepts an external `bus` so TUI, EventStore, and TranscriptWriter can subscribe before the debate starts. If not provided, runner creates one internally.

9. **Graceful degradation** — Judge verdict extraction doesn't crash if the judge skips the tool call. Gemini A→B fallback recovers from resume failures. `closeAll()` uses `Promise.allSettled` to swallow individual cleanup errors.

10. **DebateDirector as pure-logic decision layer** — All "when to do what" logic lives in `DebateDirector` (orchestrator-core), making it testable with crafted state snapshots. Runner is a pure executor. Director evaluates `DebateState → DirectorAction`, with zero I/O. Stagnation detection, degradation treatment (3-layer escalation), adaptive Judge scheduling, and clarification flow are all Director responsibilities.

11. **Mandatory `director.action` events** — Every Director evaluation is persisted as a `director.action` event in JSONL. This provides an audit trail and enables meaningful replay — without it, replay cannot explain why Judge was triggered or why debate ended early.

12. **Bounded session memory (4-layer prompts)** — Prompts are structured into 4 layers with bounded size (~3–5.5K chars), not O(n) full-transcript inclusion. Long-term debate memory is extracted from `DebateState` (structured data), not from raw conversation history. This prevents O(n²) token growth in providers with persistent threads (Codex) and keeps prompt size roughly constant across rounds.

---

## File Layout

```
crossfire/
├── packages/
│   ├── adapter-core/        # Types, Zod schemas, contract test framework
│   ├── adapter-claude/      # Claude Agent SDK wrapper
│   ├── adapter-codex/       # Codex JSON-RPC stdio wrapper
│   ├── adapter-gemini/      # Gemini subprocess + resume manager
│   ├── orchestrator-core/   # Pure: types, projection, convergence, meta-tool, context-builder, debate-memory, director/
│   ├── orchestrator/        # Effects: runner, judge, event-bus, event-store, transcript-writer
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
| TUI         | Store projection, buffer management, component rendering                                                    | Scripted events + `ink-testing-library`                                | Always              |
| Wiring      | CLI factories (createAdapters, createBus, createTui)                                                        | Mock adapters                                                          | Always              |
| Integration | Real adapter + orchestrator + Director round-trips                                                          | 9-combo matrix (claude x codex x gemini), headless                     | `RUN_INTEGRATION=1` |

Total: ~336 unit/contract tests + Director tests + 9 integration tests (skipped by default).
