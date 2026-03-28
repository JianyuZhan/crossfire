# Adapter Layer

> Provider normalization, session handling, and adapter contracts.

Back to the overview: [overview.md](./overview.md)

See also:

- [Orchestrator](./orchestrator.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

The adapter layer converts provider-specific transports, streaming protocols, and approval flows into a shared `NormalizedEvent` stream consumed by the orchestrator, TUI, persistence, and replay paths.

Packages:

- `adapter-core`
- `adapter-claude`
- `adapter-codex`
- `adapter-gemini`

Responsibilities:

- define the shared adapter interface, event types, runtime event schema, capability model, and contract tests
- normalize provider-native events into stable Crossfire event kinds
- track provider session IDs and transcript state needed for recovery
- attach adapter-local prompt metrics alongside provider-reported usage when available

## AgentAdapter Interface

```ts
interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  startSession(input: StartSessionInput): Promise<SessionHandle>;
  sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle>;
  onEvent(cb: (e: NormalizedEvent) => void): () => void;
  approve?(req: ApprovalDecision): Promise<void>;
  interrupt?(turnId: string): Promise<void>;
  close(handle: SessionHandle): Promise<void>;
}
```

Behavioral notes:

- `startSession()` allocates an adapter session and returns a `SessionHandle`. `providerSessionId` may still be `undefined` at this point for Claude and Gemini.
- `sendTurn()` means “adapter accepted and began processing the turn”, not “turn finished”.
- `session.started` should appear at most once per adapter session.
- `turn.completed` is the only authoritative end-of-turn signal.
- `turn.completed` must be the last event for its `turnId`.
- `onEvent()` delivers events for every session owned by the adapter instance, but the current Codex adapter effectively assumes one live session per adapter instance because it shares one JSON-RPC transport and wildcard notification router.
- `approve?` and `interrupt?` may be `undefined`.
- `close()` is best-effort cleanup; exact behavior is provider-specific.

## NormalizedEvent

TypeScript models `NormalizedEvent` as a 16-kind discriminated union rooted on `kind`. At runtime, `event-schema.ts` validates those 16 known kinds and also accepts forward-compatible unknown kinds that satisfy the shared base event fields.

Shared base fields:

```ts
interface BaseEvent {
  kind: string;
  timestamp: number;
  adapterId: "claude" | "codex" | "gemini";
  adapterSessionId: string;
  turnId?: string;
}
```

Categories:

- Session: `session.started`
- Text: `message.delta`, `message.final`
- Thinking: `thinking.delta`
- Plan: `plan.updated`
- Tools: `tool.call`, `tool.progress`, `tool.result`
- Approvals: `approval.request`, `approval.resolved`
- Subagents: `subagent.started`, `subagent.completed`
- Metrics: `usage.updated`
- Turn lifecycle: `turn.completed`
- Errors: `run.error`, `run.warning`

Usage fields shared by `usage.updated` and `turn.completed.usage`:

- `inputTokens`
- `outputTokens`
- `totalCostUsd?`
- `cacheReadTokens?`
- `cacheWriteTokens?`
- `semantics?`
- `localMetrics?`

Usage semantics:

- `per_turn`: provider reports usage scoped to the current turn
- `cumulative_thread_total`: provider reports cumulative totals for the whole thread; consumers must delta it locally
- `session_delta_or_cached`: provider reports session/turn deltas and may separately expose cache reads or writes
- `unknown`: provider semantics are not understood well enough to classify

Important notes:

- `event-schema.ts` now enforces the richer usage shape, including `cacheReadTokens`, `cacheWriteTokens`, `semantics`, and `localMetrics`
- adapters may omit optional usage payloads on `turn.completed`
- `usage.updated` is the primary accounting path; `turn.completed.usage` is best-effort convenience data
- Codex currently reports usage through `usage.updated` and usually emits `turn.completed` without a `usage` payload
- consumers must ignore unknown kinds and extra fields they do not understand

Why these events and fields matter:

- `turn.completed` is not optional ceremony; orchestrator control flow waits on it before advancing to the next turn or synthesis phase
- `usage.updated` is the main usage-accounting contract used by the TUI and metrics views; consumers should not rely on `turn.completed.usage` always being present
- `semantics` is required because providers do not report usage the same way; for example, Codex reports cumulative thread totals, so consumers must delta those values locally
- `cacheReadTokens` and `localMetrics` are not decorative metadata; current consumers use them to show cache behavior and local prompt-size overhead
- the event vocabulary is therefore a shared runtime contract between adapters and consumers, not an arbitrary naming layer

## Capability Model

`AdapterCapabilities` currently includes:

- `supportsResume`
- `resumeMode`
- `resumeStability`
- `supportsExternalHistoryInjection`
- `supportsRawThinking`
- `supportsReasoningSummary`
- `supportsPlan`
- `supportsApproval`
- `supportsInterrupt`
- `supportsSubagents`
- `supportsStreamingDelta`

Current provider capability profiles:

- Claude: protocol-native stable resume, external history injection, raw thinking, approvals, interrupts, subagents, and streaming deltas
- Codex: protocol-native stable resume, external history injection, reasoning summaries, plans, approvals, interrupts, and streaming deltas
- Gemini: native CLI resume marked experimental, external history injection, raw thinking, and streaming deltas

Contract tests enforce selected capability claims and exercise approval and interrupt behavior where those surfaces exist.

## Session, Turn, and Recovery Types

### SessionHandle

```ts
interface SessionHandle {
  adapterSessionId: string;
  providerSessionId: string | undefined;
  adapterId: "claude" | "codex" | "gemini";
  transcript: TurnRecord[];
  recoveryContext?: RecoveryContext;
}
```

Adapters maintain a universal transcript built from `message.final` events so they can rebuild state after provider session loss. Transcript entries are only recorded when the turn role and round number are known, either from `TurnInput` or by parsing turn IDs such as `p-1`, `c-2`, and `j-3`.

### RecoveryContext

```ts
interface RecoveryContext {
  systemPrompt: string;
  topic: string;
  role: "proposer" | "challenger" | "judge";
  maxRounds: number;
  schemaType: "debate_meta" | "judge_verdict";
}
```

### TurnInput

```ts
interface TurnInput {
  prompt: string;
  turnId: string;
  timeout?: number;
  role?: "proposer" | "challenger" | "judge";
  roundNumber?: number;
}
```

### StartSessionInput

```ts
interface StartSessionInput {
  profile: string;
  workingDirectory: string;
  model?: string;
  mcpServers?: Record<string, unknown>;
  permissionMode?: "auto" | "approve-all" | "deny-all";
  providerOptions?: Record<string, unknown>;
}
```

## Provider Internals

### Claude

- in-process SDK `query()` stream
- `startSession()` creates only the adapter handle; `providerSessionId` becomes known when the first `system/init` event arrives
- session state is tracked in a local query-context map keyed by `adapterSessionId`
- tool and subagent lifecycle visibility comes from SDK hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, and `SubagentStop`
- approval support is bridged through `canUseTool(toolName, input, options)`, which emits `approval.request` and blocks until `approve()` resolves it
- `approve()` may also pass `updatedInput`
- local prompt metrics are attached to the first `usage.updated` event observed for the turn
- on stream failure, if `recoveryContext` and a prior `providerSessionId` exist, the adapter emits `run.warning`, clears resume state, and retries once with a transcript recovery prompt
- if transcript recovery also fails, the adapter emits a terminal `run.error`

### Codex

- subprocess + bidirectional JSON-RPC over stdio
- `startSession()` performs `initialize`, sends `initialized`, then calls `thread/start`
- `session.started` is emitted directly from `startSession()`, so Codex knows its `providerSessionId` before the first turn
- `sendTurn()` uses `turn/start`
- the current adapter effectively assumes one live active session per adapter instance because event routing uses one shared JSON-RPC client plus a wildcard notification handler
- approval requests are normalized as `command`, `file-change`, or `user-input`
- `debate_meta` and `judge_verdict` are invoked through shell commands; successful command output is parsed back into synthetic `tool.call` events so downstream projection can read structured metadata
- Codex emits `thinking.delta` as reasoning summaries, not raw thinking
- in current observed behavior, Codex often delays visible `message.delta` output until late in the turn and then emits many deltas in a short burst; this still satisfies the streaming contract, but can feel less continuously streamed than Claude
- meta-tool instructions are appended only on the first turn of a session; local metrics account for this first-turn adapter overhead
- `thread/tokenUsage/updated` is normalized as `usage.updated` with `semantics: "cumulative_thread_total"`
- `turn.completed` does not currently include a `usage` payload
- on `turn/start` failure, if `recoveryContext` exists, the adapter creates a new thread, rebuilds context with `buildTranscriptRecoveryPrompt(...)`, reapplies meta-tool instructions, and retries the turn
- `close(handle)` tears down the shared JSON-RPC transport, not just one thread handle

### Gemini

- new subprocess per turn
- `startSession()` creates adapter-side bookkeeping only; `providerSessionId` remains `undefined` until the first successful `init` event
- resume is attempted through CLI arguments managed by `ResumeManager`
- `session.started` is emitted from the first successful `init` event and is not re-emitted on later turns or fallback retries
- current CLI normalization reads assistant text from `message.content`, tool metadata from `tool_id` / `tool_name` / `parameters`, tool results from `tool_id` plus `status`, and usage from `result.stats`
- raw-thinking support depends on the CLI actually emitting `thought` events; current real runs may produce no `thinking.delta` even when text streaming and tool events are present
- `message.delta` events are buffered; `message.final` is synthesized from the accumulated buffer before `usage.updated` and `turn.completed`
- local prompt metrics are attached to `usage.updated`
- the adapter enforces a single `turn.completed` emission even across crash-and-retry fallback paths
- on a failed resume attempt, the adapter emits `run.warning`, kills the failed process, and retries with either transcript recovery or a weaker stateless prompt reconstruction
- Gemini supports neither approvals nor interrupts in the current protocol integration

## Recovery Fallback

When provider-native resume fails, adapters first look for `recoveryContext` and may rebuild context with `buildTranscriptRecoveryPrompt()`. Recovery is transcript-driven rather than provider-history-driven.

Important scope note:

- `supportsExternalHistoryInjection` currently describes adapter-level recovery capability, not a user-facing CLI or TUI feature
- Crossfire does not yet expose a public `--history-file` flag or live history-import command; external history is still internal to transcript recovery paths

Current high-level behavior:

- Claude retries in a new query without `resume`; this path requires both `recoveryContext` and an existing provider session to have failed
- Codex creates a new thread and retries with a transcript recovery prompt when `recoveryContext` is available
- Gemini falls back from native CLI resume to transcript recovery only when both `recoveryContext` and transcript entries exist; otherwise it uses a weaker stateless prompt path

## Contract Tests

Shared adapter contract coverage includes:

- happy path session/turn lifecycle
- exactly-once `session.started`
- multi-turn behavior
- tool lifecycle and tool failure
- `tool.call` must precede `tool.result` for the same `toolUseId`
- `approval.request` must precede `approval.resolved` for the same `requestId`
- `turn.completed` must be the last event for its `turnId`
- approval and interrupt flows when supported
- cleanup basics
- selected capability consistency (`supportsPlan`, `supportsApproval`, and `supportsSubagents`) plus approval and interrupt behavior when those surfaces are implemented

Real-adapter integration tests are opt-in via `RUN_INTEGRATION=1`, with provider-specific availability checks.
