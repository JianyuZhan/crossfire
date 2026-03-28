# Adapter Layer

> Provider normalization, session handling, and adapter contracts.

Back to the overview: [overview.md](./overview.md)

See also:

- [Orchestrator](./orchestrator.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

The adapter layer normalizes provider-specific protocols into a shared `NormalizedEvent` stream.

Packages:

- `adapter-core`
- `adapter-claude`
- `adapter-codex`
- `adapter-gemini`

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

- `sendTurn()` means “adapter accepted and began processing the turn”, not “turn finished”.
- `turn.completed` is the only authoritative end-of-turn signal.
- `onEvent()` delivers events for every session owned by the adapter instance, but the current Codex adapter effectively assumes one live session per adapter instance because it shares one JSON-RPC transport and wildcard notification router.
- `approve?` and `interrupt?` may be `undefined`.
- `close()` is best-effort cleanup; exact behavior is provider-specific.

## NormalizedEvent

`NormalizedEvent` is a 16-kind discriminated union rooted on `kind`.

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

Important notes:

- type definitions for usage are richer than the current runtime schema in some places (`cacheReadTokens`, `cacheWriteTokens`, `semantics`, and `localMetrics` are typed but not enforced by `event-schema.ts`)
- adapters may omit optional usage payloads on `turn.completed`
- consumers must ignore unknown kinds

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

Contract tests enforce selected capability claims and exercise approval / interrupt behavior where those surfaces exist.

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

Adapters maintain a universal transcript built from `message.final` events so they can rebuild state after provider session loss.

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
- session state tracked in a local query-context map
- `providerSessionId` becomes known after the first provider init event
- tool visibility via SDK hooks (`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`SubagentStart`/`SubagentStop`) — each matcher uses the `{ hooks: [asyncFn] }` format required by SDK ≥0.1.77
- approval support comes from `canUseTool(toolName, input, options)` returning `PermissionResult`
- supports interrupts and subagent events

### Codex

- subprocess + bidirectional JSON-RPC over stdio
- `startSession()` initializes a thread and returns the provider thread ID
- `sendTurn()` uses `turn/start`
- the current adapter assumes one live session per adapter instance; `close(handle)` tears down the shared transport
- approval requests are normalized as `command`, `file-change`, or `user-input`
- shell output from `debate_meta` / `judge_verdict` commands is normalized back into synthetic `tool.call` events
- supports plans, approvals, and interrupts
- usage semantics are cumulative thread totals

### Gemini

- new subprocess per turn
- native resume path with fallback to transcript-based recovery or, failing that, a weaker stateless prompt path
- when transcript recovery is unavailable, current fallback is weaker: it falls back to a stateless prompt path rather than reconstructing prior turns from stored history
- `message.final` is synthesized before `turn.completed`
- supports streaming and resume, but not approvals or interrupts

## Recovery Fallback

When provider-native resume fails, adapters first look for `recoveryContext` and may rebuild context with `buildTranscriptRecoveryPrompt()`.

Current high-level behavior:

- Claude retries in a new query without `resume`; if `recoveryContext` exists, it attempts transcript-based recovery even when transcript completeness is imperfect
- Codex creates a new thread and retries; if `recoveryContext` exists, it also attempts transcript-based recovery without requiring a separate transcript-length guard
- Gemini falls back from native resume to transcript recovery only when both `recoveryContext` and transcript entries exist; otherwise it uses a weaker stateless prompt path

## Contract Tests

Shared adapter contract coverage includes:

- happy path session/turn lifecycle
- multi-turn behavior
- tool lifecycle and tool failure
- approval and interrupt flows when supported
- cleanup basics
- selected capability consistency (`supportsPlan`, `supportsApproval`, and `supportsSubagents`) plus approval / interrupt behavior when those surfaces are implemented

Real-adapter integration tests are opt-in via `RUN_INTEGRATION=1`, with provider-specific availability checks.
