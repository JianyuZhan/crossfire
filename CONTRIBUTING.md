# Contributing to Crossfire

Contributions are welcome! This guide covers everything you need to get started.

Crossfire is an action-plan-first debate system: the debate loop is the mechanism, and the primary product output is the synthesized action plan backed by transcripts and replayable event logs.

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

```text
packages/
├── adapter-core/        # Shared event model, AgentAdapter interface, Zod schemas, contract tests
├── adapter-claude/      # Claude Agent SDK adapter (in-process async generator)
├── adapter-codex/       # Codex JSON-RPC 2.0 bidirectional stdio adapter
├── adapter-gemini/      # Gemini subprocess-per-turn adapter (A→B fallback)
├── orchestrator-core/   # Pure logic: state projection, convergence, prompt building, director
├── orchestrator/        # Side effects: debate runner, DebateEventBus, EventStore, TranscriptWriter, synthesis
├── tui/                 # Ink (React for CLI) components, TuiStore, EventSource/PlaybackClock
└── cli/                 # Commander.js entry, YAML profile system, wiring factories
```

**Key design principles:**

- **Event sourcing** — All state = `projectState(events[])`. Pure reducer, deterministic replay.
- **Pure core / effectful shell** — `-core` packages have zero I/O dependencies.
- **Capability-gated adapters** — `approve?`/`interrupt?` are `undefined` when unsupported, not no-op.
- **Action-plan-first pipeline** — The live debate feeds a post-debate synthesis step that generates the final report with fallback behavior when model-backed synthesis fails.

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
- If a code change affects architecture, update the relevant files in `docs/architecture/` in the same commit
- If a code change affects end-user behavior, update both `README.md` and `README.zh-CN.md`

## Agent Development

Crossfire currently maintains repository-level instruction surfaces for three agent environments:

- `AGENTS.md` — shared cross-agent project contract
- `CLAUDE.md` — Claude-specific entry point that imports `AGENTS.md`
- `.gemini/settings.json` — Gemini settings that point back to `AGENTS.md`

When updating these files, keep `AGENTS.md` minimal and contract-focused:

- Only document stable repository contracts that contributors can verify in code or architecture docs
- Prefer build/test commands, event-flow rules, documentation-update requirements, and product constraints over prompt tactics
- Do not add agent-specific behavior to `AGENTS.md` unless it is genuinely shared across environments
- Do not encode undocumented workflow details, temporary preferences, or implementation guesses as project rules

If behavior is specific to one environment, keep it in that environment's entry point and leave the shared contract in `AGENTS.md` untouched unless the shared contract itself changed

## Key Files for Contributors

| File                                                | What you'll find                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/architecture/overview.md`                     | Architecture home page and document map                              |
| `docs/architecture/`                                | Detailed subsystem architecture references                           |
| `AGENTS.md`                                         | Shared contract for repository-aware agent environments              |
| `CLAUDE.md`                                         | Claude-specific instruction entry point                              |
| `.gemini/settings.json`                             | Gemini settings that point to the shared repository contract         |
| `packages/adapter-core/src/types.ts`                | `NormalizedEvent`, `AgentAdapter` interface                         |
| `packages/orchestrator-core/src/types.ts`           | `DebateState`, `DebateConfig`, debate types                         |
| `packages/orchestrator-core/src/context-builder.ts` | Incremental debate prompt construction                              |
| `packages/orchestrator/src/runner.ts`               | Main debate loop                                                    |
| `packages/orchestrator/src/final-synthesis.ts`      | Final action-plan synthesis session runner                          |
| `packages/tui/src/state/tui-store.ts`               | TUI state projection                                                |
| `packages/cli/src/wiring/create-factories.ts`       | Provider adapter factory registration                               |
| `packages/cli/src/profile/resolver.ts`              | Profile `agent` to adapter-type resolution                          |

## Adding a New Adapter

1. Create `packages/adapter-<name>/` implementing the `AgentAdapter` interface from `adapter-core`
2. Map your protocol's events to the shared `NormalizedEvent` model and respect capability-gated methods such as `approve` and `interrupt`
3. Run `runContractTests()` from `adapter-core` and add package-specific tests for provider quirks or transport behavior
4. Register the adapter in `packages/cli/src/wiring/create-factories.ts`
5. Update adapter resolution and profiles so the new provider can be selected from the CLI
6. Update the relevant architecture docs and contributor-facing docs if the extension changes user-facing behavior or system boundaries

## Submitting Changes

1. Fork the repository and create a feature branch
2. Write tests for your changes (TDD preferred)
3. Ensure all tests pass: `pnpm test`
4. Ensure linting passes: `pnpm lint`
5. Submit a pull request with a clear description of the changes
