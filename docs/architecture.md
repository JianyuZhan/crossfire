# Crossfire Architecture

> Entry point for the architecture reference set.

## Table of Contents

- [Overview](#overview)
- [Document Map](#document-map)
- [Cross-Cutting Contracts](#cross-cutting-contracts)
- [Package Dependency Graph](#package-dependency-graph)
- [End-to-End Flow](#end-to-end-flow)
- [Documentation Maintenance](#documentation-maintenance)

## Overview

Crossfire is an event-sourced debate orchestrator for multiple AI agent providers. The system is split into four runtime layers:

1. **Adapter layer** normalizes provider-specific protocols into a shared `NormalizedEvent` stream.
2. **Orchestrator layer** projects debate state from events and executes the debate loop.
3. **TUI layer** renders live and replayed debates from the same event stream.
4. **CLI layer** wires profiles, adapters, persistence, and presentation together.

This file stays intentionally short and stable. Detailed subsystem references live under [`docs/architecture/`](./architecture/).

## Document Map

- [System Overview](./architecture/overview.md)
  Covers package boundaries, end-to-end flow, key design decisions, file layout, and testing strategy.
- [Adapter Layer](./architecture/adapter-layer.md)
  Covers `AgentAdapter`, normalized event contracts, session/recovery types, provider internals, and adapter contract tests.
- [Orchestrator](./architecture/orchestrator.md)
  Covers debate state/types, projection, `DebateDirector`, runner flow, prompt building, and judge execution.
- [Action Plan Synthesis](./architecture/synthesis.md)
  Covers the adaptive synthesis pipeline, scoring, shrinking, debug metadata, transcript handling, and fallback behavior.
- [TUI and CLI](./architecture/tui-cli.md)
  Covers `TuiStore`, replay, persistence, CLI commands, wiring modules, and resume/status behavior.

## Cross-Cutting Contracts

These are the architecture-level contracts that other documents assume:

- `turn.completed` is the authoritative signal that a turn is over.
- `onEvent()` delivers events from all sessions owned by an adapter instance; consumers must filter by `adapterSessionId`.
- `approve?` and `interrupt?` are capability-gated and may be `undefined`.
- Unknown event kinds must be ignored for forward compatibility.
- Debate state is derived from `projectState(events[])`; mutable global state is not authoritative.
- The final deliverable is the action plan, not the debate transcript.

For details:

- Adapter semantics: [Adapter Layer](./architecture/adapter-layer.md)
- Debate-state and director semantics: [Orchestrator](./architecture/orchestrator.md)
- Final report generation: [Action Plan Synthesis](./architecture/synthesis.md)
- Persistence/replay semantics: [TUI and CLI](./architecture/tui-cli.md)

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

Core rule: pure logic lives in `*-core` packages; I/O and process control live in outer packages.

## End-to-End Flow

```text
Adapters emit NormalizedEvent
  → DebateEventBus merges adapter + orchestrator events
  → projectState(events[]) derives DebateState
  → DebateDirector / runner decide next action
  → TUI, EventStore, TranscriptWriter, and PlanAccumulator subscribe in parallel
  → post-debate synthesis writes action-plan.md/html
```

See also:

- [System Overview](./architecture/overview.md#event-flow)
- [Orchestrator](./architecture/orchestrator.md#runner)
- [Action Plan Synthesis](./architecture/synthesis.md#pipeline-overview)
- [TUI and CLI](./architecture/tui-cli.md#persistence-and-replay)

## Documentation Maintenance

- `docs/architecture.md` remains the stable architecture entry point referenced by the repo.
- Detailed architecture material is split across the linked files under [`docs/architecture/`](./architecture/).
- If a code change alters types, interfaces, event kinds, component structure, CLI options, or data flow:
  1. update the relevant detailed architecture page(s),
  2. keep `docs/architecture.md` staged in the same commit,
  3. adjust this entry page if the document map or cross-cutting contracts changed.
- Prefer stable section titles in detailed docs. Put counts like “13 event types” in body text rather than headings when possible.

