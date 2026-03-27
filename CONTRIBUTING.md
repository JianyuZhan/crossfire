# Contributing to Crossfire

Contributions are welcome! This guide covers everything you need to get started.

## Development Setup

```bash
git clone https://github.com/jyzhan/crossfire.git
cd crossfire
pnpm install
pnpm build            # Build all 8 packages (Turborepo)
pnpm test             # Run unit/contract tests (~450 tests)
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
```

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- At least one agent CLI for integration tests: `claude`, `codex`, or `gemini`

## Tech Stack

| Tool         | Purpose                              |
| ------------ | ------------------------------------ |
| TypeScript   | Language (strict mode, ESM)          |
| pnpm         | Package manager (workspace monorepo) |
| Turborepo    | Build orchestration                  |
| Vitest       | Testing                              |
| Biome        | Linting and formatting               |
| Ink          | Terminal UI (React for CLI)          |
| Zod          | Runtime schema validation            |
| Commander.js | CLI framework                        |

## Project Structure

```
packages/
├── adapter-core/        # NormalizedEvent (16 kinds), AgentAdapter interface, Zod schemas, contract tests
├── adapter-claude/      # Claude Agent SDK adapter (in-process async generator)
├── adapter-codex/       # Codex JSON-RPC 2.0 bidirectional stdio adapter
├── adapter-gemini/      # Gemini subprocess-per-turn adapter (A→B fallback)
├── orchestrator-core/   # Pure logic: state projection, convergence, context-builder, debate-memory, director
├── orchestrator/        # Side effects: debate runner, DebateEventBus, EventStore (JSONL), TranscriptWriter
├── tui/                 # Ink (React for CLI) components, TuiStore, EventSource/PlaybackClock
└── cli/                 # Commander.js entry, YAML profile system, wiring factories
```

**Key design principles:**

- **Event sourcing** — All state = `projectState(events[])`. Pure reducer, deterministic replay.
- **Pure core / effectful shell** — `-core` packages have zero I/O dependencies.
- **Capability-gated adapters** — `approve?`/`interrupt?` are `undefined` when unsupported, not no-op.
- **Bounded session memory** — 4-layer prompt structure with extraction from `DebateState`, not raw transcript.

For the architecture reference set, start at **[docs/architecture/overview.md](docs/architecture/overview.md)**.

> **Note:** The architecture docs are split across multiple pages. When in doubt, the source code is authoritative.

## Running Tests

```bash
# Unit and contract tests (no external dependencies)
pnpm test

# Single package
pnpm --filter @crossfire/adapter-claude test

# Integration tests (requires real agent CLIs)
RUN_INTEGRATION=1 pnpm test

# Specific adapter combos
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini \
  pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts

# Full 9-combo matrix (Claude + Codex + Gemini)
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini HAVE_GEMINI=1 \
  pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts

# Single combo
RUN_INTEGRATION=1 HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini HAVE_GEMINI=1 \
  pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts -t "gemini vs claude"
```

**Important:** Always run `pnpm build` after modifying source files — the CLI executes compiled output from `dist/`, not source directly.

## Project Conventions

- **TDD** — Write failing test first, then implement, then verify
- Node.js 20+, ESM (`"type": "module"`)
- Strict TypeScript throughout
- Biome for lint + format (tabs, not spaces)
- All code, comments, variable names, and commit messages in **English**

## Key Files for Contributors

| File                                                | What you'll find                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/architecture/overview.md`                     | Architecture home page and document map                              |
| `docs/architecture/`                                | Detailed subsystem architecture references                           |
| `packages/adapter-core/src/types.ts`                | `NormalizedEvent`, `AgentAdapter` interface                         |
| `packages/orchestrator-core/src/types.ts`           | `DebateState`, `DebateConfig`, debate types                         |
| `packages/orchestrator-core/src/context-builder.ts` | Incremental debate prompt construction                              |
| `packages/orchestrator/src/runner.ts`               | Main debate loop                                                    |
| `packages/tui/src/state/tui-store.ts`               | TUI state projection                                                |
| `packages/cli/src/commands/start.ts`                | CLI `start` command wiring                                          |

## Adding a New Adapter

1. Create `packages/adapter-<name>/` implementing the `AgentAdapter` interface from `adapter-core`
2. Map your protocol's events to `NormalizedEvent` (16 kinds)
3. Run `runContractTests()` from `adapter-core` to validate (12 test categories)
4. Register the adapter in `packages/cli/src/commands/start.ts`

## Submitting Changes

1. Fork the repository and create a feature branch
2. Write tests for your changes (TDD preferred)
3. Ensure all tests pass: `pnpm test`
4. Ensure linting passes: `pnpm lint`
5. Submit a pull request with a clear description of the changes
