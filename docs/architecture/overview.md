# System Overview

> Cross-system architecture summary.

Architecture home page.

## Scope

This page covers the parts of the system that span multiple layers:

- package boundaries
- end-to-end event flow
- key design decisions
- repository layout
- testing strategy

Subsystem details live in:

- [Adapter Layer](./adapter-layer.md)
- [Execution Modes](./execution-modes.md)
- [Orchestrator](./orchestrator.md)
- [Action Plan Synthesis](./synthesis.md)
- [TUI and CLI](./tui-cli.md)

## Layer Summary

- **Adapter layer** converts Claude, Codex, and Gemini protocols into a shared event model.
- **Orchestrator layer** runs the debate loop using event projection plus a pure decision layer.
- **TUI layer** renders live and replayed debates from the same event stream.
- **CLI layer** loads profiles, builds adapters, creates persistence, and starts the debate.

## Package Dependency Graph

```text
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

Key principle: pure logic lives in `-core` packages, while file/process/network effects live in the outer packages.

## Event Flow

```text
Adapter (Claude/Codex/Gemini)
  → emits NormalizedEvent
  → DebateEventBus
    → TuiStore
    → EventStore (events.jsonl + index.json)
    → TranscriptWriter (transcript.md + transcript.html)
    → PlanAccumulator
    → Runner / DebateDirector
  → post-debate synthesis
    → synthesis.started / synthesis.error / synthesis.completed
    → action-plan.md
    → action-plan.html
```

Important implications:

- replay and resume are possible because the event log is authoritative
- TUI and orchestration consume the same logical event stream
- action-plan generation is a post-debate pipeline, not part of live turn execution
- resume keeps prior segments intact; root `roundOffsets` / `turnOffsets` currently describe the latest write only

## Key Design Decisions

1. **Event sourcing over imperative state**
   All runtime state is derived from `projectState(events[])`.
2. **Pure core / effectful shell**
   `adapter-core` and `orchestrator-core` are designed to be testable without I/O.
3. **Capability-gated interfaces**
   Adapter features such as approvals and interrupts are represented explicitly in types.
4. **Shared event stream**
   The bus is the integration point for UI, persistence, transcript writing, and orchestration.
5. **Sequential turn-taking**
   One agent speaks at a time; `turn.completed` gates progress.
6. **Incremental debate prompts**
   Debate turns rely on provider-native session memory rather than replaying the full transcript every turn.
7. **Adaptive final synthesis**
   The final action plan is generated in a new isolated session using an adaptive prompt budget strategy.
8. **Segment-based resume**
   Resume appends new event segments rather than mutating the original log.

## File Layout

```text
crossfire/
├── packages/
│   ├── adapter-core/
│   ├── adapter-claude/
│   ├── adapter-codex/
│   ├── adapter-gemini/
│   ├── orchestrator-core/
│   ├── orchestrator/
│   ├── tui/
│   └── cli/
├── profiles/
├── docs/
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── adapter-layer.md
│   │   ├── execution-modes.md
│   │   ├── orchestrator.md
│   │   ├── synthesis.md
│   │   └── tui-cli.md
│   └── superpowers/
├── turbo.json
├── tsconfig.base.json
├── vitest.config.ts
└── biome.json
```

## Testing Strategy

| Layer | Focus | Notes |
| --- | --- | --- |
| Unit | pure reducers, prompt builders, schemas, mappers | no external dependencies |
| Contract | adapter interface compliance | shared `runContractTests()` |
| Director | `DebateDirector` and detectors | crafted `DebateState` snapshots |
| Synthesis | adaptive assembly, shrinking, scoring, fallbacks | pure-function heavy |
| TUI | store projection, rendering, replay behavior | `ink-testing-library` |
| Wiring | CLI factories and command wiring | mocks around adapters/bus |
| Integration | real providers + orchestrator | env-gated provider matrix |

Current integration coverage is env-expanded: `RUN_INTEGRATION=1` enables the base suite, while `HAVE_CODEX` and `HAVE_GEMINI` expand provider combinations.

## Internal Code Quality

Key internal helpers and abstractions extracted across packages to reduce duplication:

- **adapter-core**: `AdapterId`, `DebateRole`, and `UsageSnapshot` shared type aliases reduce repetition across event and interface definitions.
- **adapter-claude**: `consumeStream()` unifies the event processing loop for normal and recovery paths.
- **adapter-codex**: `handleResponse/handleServerRequest/handleNotification` decompose the monolithic JSON-RPC message handler.
- **orchestrator**: `getLatestTurnContent()`, `invokeJudge()`, and `applyRoundToPlan()` reduce the runner and plan accumulator to focused, testable units.
- **orchestrator-core**: `wireMetaToDomain()` centralizes the snake_case-to-camelCase meta conversion. Lookup tables replace nested ternaries in renderers.
- **tui**: `TOOL_STATUS_ICONS`, `TOOL_PREFIXES`, and `ScrollStatus` component replace deeply nested ternaries with data-driven rendering.
