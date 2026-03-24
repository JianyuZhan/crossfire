# Crossfire

## Language Policy

- All code, comments, variable names, commit messages, and documentation MUST be written in English.
- No Chinese or other non-English text in source files, tests, or generated output.

## Project Structure

TypeScript pnpm monorepo (8 packages). Full architecture: `docs/architecture.md`.

### Adapter Layer

- `adapter-core` — Shared types (`NormalizedEvent` 16-kind union, `AgentAdapter` interface), Zod schemas, contract test framework
- `adapter-claude` — Claude Agent SDK adapter (in-process async generator)
- `adapter-codex` — Codex JSON-RPC 2.0 stdio adapter
- `adapter-gemini` — Gemini CLI subprocess adapter (per-turn, A→B fallback)

### Orchestrator Layer

- `orchestrator-core` — Pure logic: event types, `projectState()` reducer, convergence detection, meta-tool Zod schemas, context-builder
- `orchestrator` — Side effects: `runDebate()` main loop, judge turn, `DebateEventBus`, `EventStore` (JSONL persistence), `TranscriptWriter`

### Presentation Layer

- `tui` — Ink (React for CLI) components, `TuiStore` projection, `EventSource`/`PlaybackClock` abstraction (live + replay unified)
- `cli` — Commander.js entry point (`crossfire start|resume|replay|status`), YAML profile system (gray-matter + Zod), wiring factories

### Other

- `profiles/` — YAML frontmatter role profiles (proposer, challenger, judge, moderator)
- `docs/architecture.md` — Authoritative design document (types, interfaces, data flow, all layers)

## Key Patterns

- **Event sourcing**: All state = `projectState(events[])`. No mutable accumulation.
- **Pure core / effectful shell**: `-core` packages have zero I/O dependencies.
- **Capability-gated**: `approve?`/`interrupt?` undefined when unsupported, not no-op.
- **DebateEventBus**: Merges `NormalizedEvent` + `OrchestratorEvent`. All consumers subscribe here.
- **Meta extraction**: Agents call `debate_meta` / `judge_verdict` tools → Zod-validated structured data (snake_case wire → camelCase domain).

## Core Types (Quick Reference)

### NormalizedEvent (16 kinds)

Session: `session.started` | Text: `message.delta`, `message.final` | Thinking: `thinking.delta` | Plan: `plan.updated` | Tools: `tool.call`, `tool.progress`, `tool.result` | Approvals: `approval.request`, `approval.resolved` | Subagents: `subagent.started`, `subagent.completed` | Metrics: `usage.updated` | Turn: `turn.completed` | Errors: `run.error`, `run.warning`

Every event carries: `kind`, `timestamp`, `adapterId`, `adapterSessionId`, `turnId?`, `providerSessionId?`.

### OrchestratorEvent (7 kinds)

`debate.started`, `debate.resumed`, `round.started`, `round.completed`, `judge.started`, `judge.completed`, `debate.completed`

### DebateState

```typescript
{ config, phase: "idle"|"proposer-turn"|"challenger-turn"|"judging"|"completed",
  currentRound, turns: DebateTurn[], convergence, terminationReason? }
```

### AgentAdapter Interface

```typescript
{ id, capabilities, startSession(), sendTurn(), onEvent(), approve?(), interrupt?(), close() }
```

**Critical behavioral contracts:**

- `sendTurn()` resolves when streaming BEGINS, not ends. Completion = `turn.completed` event.
- `onEvent()` delivers events from ALL sessions. Filter on `adapterSessionId`.
- `approve()`/`interrupt()` are `undefined` (not no-op) when unsupported.
- `close()` is imperative, no `session.closed` event.
- Unknown event kinds MUST be ignored (forward compatibility).

## Adapter Gotchas

| Adapter | `providerSessionId` set when               | Resume strategy                                |
| ------- | ------------------------------------------ | ---------------------------------------------- |
| Claude  | First `sendTurn()` (`system/init` message) | `resume: sessionId` param                      |
| Codex   | `startSession()` (`thread/start` response) | Native thread resume                           |
| Gemini  | First init event's `session_id` field      | A→B fallback: `--resume` then stateless prompt |

- **Claude**: `canUseTool` callback for approvals. Hooks: `PreToolUse`→`tool.call`, `PostToolUse`→`tool.result`.
- **Codex**: Bidirectional JSON-RPC 2.0 over stdio. `requestApproval` is a JSON-RPC request from server.
- **Gemini**: New subprocess per turn. `session.started` emitted only once. A→B fallback emits `run.warning`.

## Event Flow

```
Adapter → NormalizedEvent → DebateEventBus ← OrchestratorEvent ← Runner
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
                 TuiStore    EventStore    TranscriptWriter
               (re-render)  (JSONL flush)  (transcript.md)
```

Runner reads state via `bus.snapshot()` (re-projects before every decision).

## CLI Wiring

Three factory functions, no DI container:

- `createAdapters(roles, factories)` → `AdapterBundle` (with `closeAll()` using `Promise.allSettled`)
- `createBus({ outputDir, segmentFilename? })` → `BusBundle` (bus + EventStore)
- `createTui(bus, headless)` → `TuiBundle | null`

**Profile resolution:** `./profiles/` → `~/.config/crossfire/profiles/`. Model priority: `--proposer-model` > `--model` > `profile.model` > provider default.

**Resume:** New JSONL segment per resume (`events-resumed-{ts}.jsonl`). `index.json` tracks segments. `loadSegments()` concatenates in order.

## TUI Key Details

- `EventSource` + `PlaybackClock` abstractions unify live and replay — same `<App>` renders both.
- `TuiStore` projects raw events into render-ready `TuiState` (agent panels, metrics, commands).
- `thinkingText` capped at 4KB (front-trimmed). `message.final` replaces streaming buffer entirely.
- Approval mode auto-activates when `approval.request` arrives.

## Testing

| Type        | Scope                                                                             | Gate                |
| ----------- | --------------------------------------------------------------------------------- | ------------------- |
| Unit        | Pure functions (projection, convergence, Zod schemas, prompt builders)            | Always              |
| Contract    | `runContractTests()` — 9 categories with `MockAdapterFactory` + `ScenarioFixture` | Always              |
| TUI         | Store projection, buffer rules, Ink components via `ink-testing-library`          | Always              |
| Wiring      | CLI factories with mock adapters                                                  | Always              |
| Integration | 9-combo matrix (claude x codex x gemini), headless                                | `RUN_INTEGRATION=1` |

~336 unit/contract + 9 integration tests (skipped by default).

## Conventions

- Node.js 20+, ESM (`"type": "module"`)
- Strict TypeScript, Biome for lint/format
- Vitest for testing, Turborepo for build orchestration
- TDD: write failing test first, then implement, then verify
- Each adapter implements `AgentAdapter` interface from `@crossfire/adapter-core`
- Commit messages use conventional commits format (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- Every commit must include `Signed-off-by` (use `git config user.name` / `git config user.email`) and `Co-Authored-By: Claude <noreply@anthropic.com>`

## Commands

```bash
pnpm build          # Build all 8 packages (Turborepo)
pnpm test           # Run all tests (Vitest workspace)
pnpm --filter @crossfire/adapter-claude test  # Test single package
pnpm lint           # Biome check
pnpm lint:fix       # Biome auto-fix
```

## Running the CLI

Development (no global install needed):

```bash
node packages/cli/dist/index.js <command> [options]
```

Or link globally once (requires `PNPM_HOME` in PATH — run `pnpm setup` first if needed):

```bash
pnpm -C packages/cli link --global   # then use `crossfire` directly
```

**Important:** Always run `pnpm build` after modifying source files — the CLI executes compiled output from `dist/`, not source directly.

### Manual TUI testing

```bash
# Claude vs Claude (judge auto-inferred as claude/judge)
node packages/cli/dist/index.js start \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --topic "Should code reviews be mandatory?" \
  --max-rounds 1

# Headless, no judge
node packages/cli/dist/index.js start \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --judge none \
  --topic "Should code reviews be mandatory?" \
  --max-rounds 1 --headless -v
```

To test with Codex, create profiles with `agent: codex` and `model: gpt-5.1-codex-mini`, or use existing profiles with `--proposer-model` / `--challenger-model` (note: model flag only overrides model, not adapter type — adapter is determined by the profile's `agent` field).

### Integration tests

```bash
# Claude-only (1 combo, requires `claude` CLI)
RUN_INTEGRATION=1 pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts --reporter=verbose

# Claude + Codex (4 combos, requires `claude` + `codex` CLIs)
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts --reporter=verbose

# Full 9-combo matrix (requires `claude` + `codex` + `gemini` CLIs)
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini HAVE_GEMINI=1 pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts --reporter=verbose

# Single combo only
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini HAVE_GEMINI=1 pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts -t "gemini vs claude" --reporter=verbose
```
