# Adapter Layer

> Provider normalization, session handling, and adapter contracts.

Back to the overview: [overview.md](./overview.md)

See also:

- [Execution Modes](./execution-modes.md)
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

Approval-specific shared types:

```ts
interface ApprovalOption {
  id: string;
  label: string;
  kind: "allow" | "deny" | "allow-always" | "other";
  scope?: "once" | "session" | "project" | "user" | "local" | "global";
  isDefault?: boolean;
}

interface ApprovalCapabilities {
  semanticOptions?: ApprovalOption[];
  nativeOptions?: ApprovalOption[];
  supportedScopes?: Array<"once" | "session" | "project" | "user" | "local" | "global">;
  supportsUpdatedInput?: boolean;
}

interface ApprovalRequestEvent {
  kind: "approval.request";
  requestId: string;
  approvalType: "tool" | "command" | "file-change" | "user-input";
  title: string;
  payload: unknown;
  suggestion?: "allow" | "deny";
  capabilities?: ApprovalCapabilities;
}

interface ApprovalDecision {
  requestId: string;
  decision: "allow" | "deny" | "allow-always";
  updatedInput?: unknown;
  optionId?: string;
}
```

Behavioral notes:

- `startSession()` allocates an adapter session and returns a `SessionHandle`. `providerSessionId` may still be `undefined` at this point for Claude and Gemini.
- `StartSessionInput.executionMode` carries the role baseline known when the adapter session is created.
- `sendTurn()` means “adapter accepted and began processing the turn”, not “turn finished”.
- `TurnInput.executionMode` carries the effective mode resolved by the orchestrator for that specific turn.
- `session.started` should appear at most once per adapter session.
- `turn.completed` is the only authoritative end-of-turn signal.
- `turn.completed` must be the last event for its `turnId`.
- `onEvent()` delivers events for every session owned by the adapter instance, but the current Codex adapter effectively assumes one live session per adapter instance because it shares one JSON-RPC transport and wildcard notification router.
- `approve?` and `interrupt?` may be `undefined`.
- `close()` is best-effort cleanup; exact behavior is provider-specific.

## NormalizedEvent

TypeScript models `NormalizedEvent` as a 17-kind discriminated union rooted on `kind`. At runtime, `event-schema.ts` validates those 17 known kinds and also accepts forward-compatible unknown kinds that satisfy the shared base event fields.

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
- Tools: `tool.call`, `tool.progress`, `tool.result`, `tool.denied`
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
- `AdapterCapabilities` remains a static adapter-level contract; request-level approval affordances now live under `approval.request.capabilities`
- `approval.request.capabilities.semanticOptions[]` describes Crossfire's normalized approval semantics for that specific request
- `approval.request.capabilities.nativeOptions[]` preserves provider-native approval choices when they exist
- `approval.request.capabilities.supportedScopes[]` and `supportsUpdatedInput` are request-scoped, not adapter-scoped, because they can vary by provider and approval type
- `approval.resolved.optionId` captures the specific provider option selected when approval is not just a plain allow/deny
- `tool.call` is intentionally only a provider-observed tool request, not a guaranteed start-of-execution signal
- `tool.denied` exists because some providers can surface permission denials without ever emitting a terminal `tool.result`
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

## Policy Model

The `adapter-core` package exports a policy compilation module (`policy/`) that replaces provider-first mode mapping with a provider-agnostic policy architecture:

- **Types** (`policy/types.ts`): `ResolvedPolicy`, `CapabilityPolicy`, `RoleContract`, `InteractionPolicy`, `PolicyPreset`, `CompilePolicyInput`, `ProviderTranslationResult<T>`
- **Observation types** (`policy/observation-types.ts`): `CompilePolicyDiagnostics`, `PolicyClampNote`, `ToolInspectionRecord`, `CapabilityEffectRecord`, `PolicyTranslationSummary`, `ProviderObservationResult` — diagnostics and inspection types for policy observability (Phase C)
- **Level-order helpers** (`policy/level-order.ts`): `clampFilesystem`, `clampNetwork`, `clampShell`, `clampSubagents` — ordered enum comparison via index, not string
- **Role contracts** (`policy/role-contracts.ts`): `DEFAULT_ROLE_CONTRACTS` — frozen defaults for proposer (no ceilings), challenger (no ceilings), judge (read/search/off/off)
- **Presets** (`policy/presets.ts`): `PRESET_EXPANSIONS` — frozen table expanding `research | guarded | dangerous | plan` to capability + interaction policy
- **Compiler** (`policy/compiler.ts`): `compilePolicy(input) → ResolvedPolicy` — preset expansion → role ceiling clamping → legacy tool override attachment; `compilePolicyWithDiagnostics(input) → CompilePolicyDiagnostics` — same compilation with clamp notes recording when role ceilings reduce preset capabilities
- **Testing** (`testing/`): shared test fixtures (`makeCompileInput`, event order helpers, resource cleanup) used across policy and adapter tests; compiler tests cover 7-case golden matrix with full 4-field assertions

Each adapter implements a `translatePolicy(ResolvedPolicy) → ProviderTranslationResult<NativeOptions>` pure function that maps the resolved policy to provider-native parameters plus structured warnings:

- **Claude** (`adapter-claude/src/policy-translation.ts`): maps approval to `ClaudePermissionMode`, capabilities to tool deny lists (`Bash`, `Edit`, `Write`, `WebFetch`, `Task`), with `isPlanShape()` for exact `plan` mode matching. Shared rule helpers are extracted in `policy-observation.ts` for use by both translation and inspection layers.
- **Codex** (`adapter-codex/src/policy-translation.ts`): maps approval to `on-request | on-failure | never`, capabilities to sandbox level (`readOnly | workspace-write | danger-full-access`) via per-dimension max, network off → `networkDisabled`
- **Gemini** (`adapter-gemini/src/policy-translation.ts`): maps approval to `default | auto_edit | plan | yolo`, with `isPlanShape()` for plan mode; filesystem/network off → `not_implemented` warnings

### Policy Integration Points

`StartSessionInput.policy?` and `TurnInput.policy?` carry an optional `ResolvedPolicy`. When present, adapters call `translatePolicy()` instead of reading the deprecated `executionMode` field. `AdapterMap` entries carry optional `baselinePolicy` and `legacyToolPolicyInput` so the orchestrator runner can thread compiled policy through to adapters.

The Claude adapter checks `input.policy ?? sessionConfig.baselinePolicy` in `sendTurn()`. When a policy is present, it calls `translatePolicy()` and emits `run.warning` events for any translation warnings. The legacy `mapExecutionModeToClaudeQueryOptions()` path is preserved as fallback when no policy is set.

The Codex adapter applies the same pattern in both `startSession()` (for `thread/start` policies) and `sendTurn()` (for per-turn policies), including the transcript recovery path. Legacy `mapExecutionModeToCodexPolicies()` is preserved as fallback.

The Gemini adapter resolves the approval mode from `input.policy ?? session.baselinePolicy` in `attemptTurn()`, reusing the resolved mode for both the primary and fallback paths. Legacy `mapExecutionModeToGeminiApprovalMode()` is preserved as fallback.

### CLI Compilation Flow

`create-adapters.ts` compiles policy at startup: CLI `--mode` flag → `PolicyPreset` → `compilePolicy({ preset, role, legacyToolPolicy })` → `ResolvedPolicy` passed via `startSession({ policy })`. Judge always gets the `plan` preset. Profile `allowed_tools`/`disallowed_tools` flow through as `legacyToolPolicy`.

The orchestrator runner recompiles policy per turn using the resolved effective mode as a preset, so turn-level overrides produce different policies without mutating the baseline. The judge turn absorbs the legacy `executionMode: "plan"` special case: when a policy is present, `executionMode` is omitted; when no policy exists, the legacy fallback is preserved. `resolveExecutionModeAsPolicy()` in `orchestrator-core` provides a compat wrapper for callers migrating incrementally.

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
  executionMode?: "research" | "guarded" | "dangerous" | "plan";
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
  executionMode?: "research" | "guarded" | "dangerous";
  providerOptions?: Record<string, unknown>;
}
```

## Provider Internals

### Claude

- in-process SDK `query()` stream
- `startSession()` creates only the adapter handle; `providerSessionId` becomes known when the first `system/init` event arrives
- session state is tracked in a local query-context map keyed by `adapterSessionId`
- Crossfire execution modes map directly onto Claude permission modes per turn: `research` → `dontAsk` + allowlist + bounded `maxTurns`, `guarded` → `default`, `dangerous` → `bypassPermissions`, `plan` → `plan`
- the Claude query function type signature accepts SDK guardrails such as `maxTurns`, `maxThinkingTokens`, and `maxBudgetUsd`; the adapter's built-in execution-mode mapping currently only sets `maxTurns` (for research mode) to cap research-mode Claude turns before they sprawl indefinitely
- tool and subagent lifecycle visibility comes from SDK hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, and `SubagentStop`
- approval support is bridged through `canUseTool(toolName, input, options)`, which emits `approval.request` and blocks until `approve()` resolves it
- `approval.request.payload` now retains Claude `suggestions`, `blockedPath`, `decisionReason`, and `agentId` metadata for display/debugging
- Claude does not expose a provider-native button array; Crossfire fills `approval.request.capabilities.semanticOptions[]` itself and augments them with SDK permission context when available
- Claude tool approvals always advertise a normalized session-scoped allow option; when the SDK does not provide reusable `suggestions`, Crossfire synthesizes a session `addRules` permission update for the requested tool instead
- `approve()` may pass both `updatedInput` and session-scoped `updatedPermissions`, so Claude's "allow for session" flow is now preserved instead of being flattened to plain allow
- once Claude has emitted `turn.completed` for a turn, trailing process-exit errors are ignored instead of triggering a spurious recovery attempt for an already-finished turn
- local prompt metrics are attached to the first `usage.updated` event observed for the turn
- on stream failure, if `recoveryContext` and a prior `providerSessionId` exist, the adapter emits `run.warning`, clears resume state, and retries once with a transcript recovery prompt; the recovery query reapplies the same policy-derived options (permission mode, tool restrictions, limits) as the original turn so policy constraints survive partial failures
- if transcript recovery also fails, the adapter emits a terminal `run.error`

### Codex

- subprocess + bidirectional JSON-RPC over stdio
- `startSession()` performs `initialize`, sends `initialized`, then calls `thread/start`
- `session.started` is emitted directly from `startSession()`, so Codex knows its `providerSessionId` before the first turn
- Crossfire execution modes map onto Codex approval and sandbox policy combinations instead of a single provider mode field; the policy path forwards `sandboxPolicy` verbatim from `translatePolicy()` and threads `networkDisabled` into `thread/start` and `turn/start` requests
- `sendTurn()` uses `turn/start`
- the current adapter effectively assumes one live active session per adapter instance because event routing uses one shared JSON-RPC client plus a wildcard notification handler
- approval requests are normalized as `command`, `file-change`, or `user-input`
- when Codex includes `availableDecisions`, Crossfire preserves them as `approval.request.capabilities.nativeOptions[]`
- Crossfire also derives `approval.request.capabilities.semanticOptions[]` for simple UI fallbacks without losing the original native decisions
- `approve()` now forwards a selected native `optionId` back to Codex as `{ decision: optionId }`; it only falls back to `{ approved: boolean }` when no richer native option exists
- `debate_meta` and `judge_verdict` are invoked through shell commands; successful command output is parsed back into synthetic `tool.call` events so downstream projection can read structured metadata
- Codex emits `thinking.delta` as reasoning summaries, not raw thinking
- empty Codex reasoning and assistant delta notifications are ignored during normalization so the TUI does not churn on blank streaming frames
- in current observed behavior, Codex often delays visible `message.delta` output until late in the turn and then emits many deltas in a short burst; this still satisfies the streaming contract, but can feel less continuously streamed than Claude
- meta-tool instructions are appended only on the first turn of a session; local metrics account for this first-turn adapter overhead
- `thread/tokenUsage/updated` is normalized as `usage.updated` with `semantics: "cumulative_thread_total"`
- `turn.completed` does not currently include a `usage` payload
- on `turn/start` failure, if `recoveryContext` exists, the adapter creates a new thread, rebuilds context with `buildTranscriptRecoveryPrompt(...)`, reapplies meta-tool instructions, and retries the turn
- `close(handle)` tears down the shared JSON-RPC transport, not just one thread handle

### Gemini

- new subprocess per turn
- `startSession()` creates adapter-side bookkeeping only; `providerSessionId` remains `undefined` until the first successful `init` event
- Crossfire execution modes currently map only to CLI approval-mode arguments: `dangerous` → `yolo`, `plan` → `plan`, `research` currently reuses `plan`, and `guarded` leaves the CLI default in place
- resume is attempted through CLI arguments managed by `ResumeManager`
- `session.started` is emitted from the first successful `init` event and is not re-emitted on later turns or fallback retries
- current CLI normalization reads assistant text from `content` or `text` fields on the event, tool metadata from `tool_id` / `tool_use_id` / `tool_name` / `name` / `parameters` / `input`, tool results from `tool_id` / `tool_use_id` plus `success` or `status` with `output`, and usage from `event.usage` (with fallback to `event.stats`)
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
