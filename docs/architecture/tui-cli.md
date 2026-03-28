# TUI and CLI

> Rendering, persistence, replay, and command wiring.

Back to the overview: [overview.md](./overview.md)

See also:

- [System Overview](./overview.md)
- [Orchestrator](./orchestrator.md)

## TUI Purpose

The TUI is an event-driven terminal renderer powered by Ink. It projects the shared event stream into render-ready state and supports both live and replay use cases.

## EventSource and PlaybackClock

Replay is built around a source abstraction:

- `LiveEventSource` for the shared app interface in live bus-driven sessions
- `ReplayEventSource` for event-log playback

Replay timing is controlled by a `PlaybackClock` implementation. In live mode, the current store is hydrated by a direct `DebateEventBus` subscription; `LiveEventSource` mainly satisfies the shared app interface.

## TuiStore

`TuiStore` is a lightweight render projection layered on top of the event stream.

It tracks:

- live proposer/challenger state
- per-round snapshots
- judge results
- metrics
- command state
- projected `DebateState`
- synthesis summary state

Important implementation notes:

- it does not re-project full debate state on every delta event
- usage accounting is provider-aware, including normalization for providers that report cumulative usage
- `thinkingText` is front-trimmed to about 4096 characters
- visible assistant text is stripped of internal `debate_meta` / `judge_verdict` JSON blocks before rendering

## Render Pipeline

The app shell is intentionally small:

```text
App
  → HeaderBar
  → ScrollableContent
  → MetricsBar
  → CommandStatusLine
  → CommandInput
```

Round/judge/summary visualization is produced indirectly through the chunk pipeline:

`TuiStore` → `rebuildChunks()` → `populateChunkLines()` → `buildGlobalLineBuffer()`

## Command Parsing and Current Wiring

Commands currently handled inside the shared Ink app shell:

- `/expand <round>`
- `/collapse <round>`
- `/jump <N>` / `/jump round <N>`
- `/top`
- `/bottom`

Runner-wired commands in `crossfire start`:

- `/inject`
- `/inject!`
- `/inject judge`
- `/stop`
- approval commands

Runner-wired commands in `crossfire resume`:

- `/inject`
- `/inject!`
- `/inject judge`
- `/stop`
- `/pause`
- `/resume`
- `/extend <N>`
- approval commands

Parsed but not currently wired:

- `/jump turn <turnId>` is parsed but has no current handler

Important wiring nuance:

- `crossfire start` and `crossfire resume` now share the same live command handler, so stop / approval / inject / pause / resume / extend behavior stays aligned across fresh and resumed runs
- the TUI command status line reflects projected live pause state so operators can tell when execution is intentionally blocked between turns
- `crossfire replay` is non-interactive and only exposes CLI flags such as `--speed` and `--from-round`; it does not surface the command parser

## Persistence and Replay

### EventStore

Writes:

- `events.jsonl`
- `index.json`

Current behavior:

- batch flush every 100ms
- force flush on `turn.completed` and `debate.completed`
- close writes final index metadata

### index.json

`index.json` is the unified metadata file. It contains:

- config and profile metadata
- root-level runtime summary fields
- round and turn offsets
- segment manifest

Resume nuance:

- `segments` accumulate across resumes
- some root-level counters and offsets describe the most recent write rather than an aggregate across all segments
- after resume, root `roundOffsets` / `turnOffsets` are latest-segment-local, so `replay --from-round` is not reliable across resumed runs today

### Replay

`replayDebate({ outputDir, speed?, startFromRound? })`:

- reads JSONL content from all listed segments
- parses all events into memory
- optionally jumps by `roundOffsets[round].eventIndex`
- replays into a `TuiStore`

The current CLI replay command is non-interactive; it does not render the full Ink app.

## CLI Purpose

The CLI is a thin assembly layer. It is responsible for:

- loading profiles
- resolving models and adapter types
- creating adapters
- creating bus/persistence
- creating TUI when not headless
- starting, resuming, replaying, or inspecting debates

## Profile System

Profiles are Markdown files with YAML frontmatter.

Key fields:

- `name`
- `description?`
- `agent`
- `model?`
- `inherit_global_config`
- `mcp_servers`

Search paths:

- `./profiles`
- `~/.config/crossfire/profiles`

Built-in profile guidance is role-specific:

- proposer and challenger profiles include research requirements that push agents toward evidence-backed claims
- challenger profiles require code/tool verification before major rebuttals when evidence is available
- judge profiles emphasize evidence responsibility and discourage broad replacement analysis on behalf of one side

## Commands

### `crossfire start`

Key behavior:

- validates topic flags and numeric options
- infers a judge profile from proposer adapter type when not provided
- creates `run_output/${debateId}` by default
- writes the initial `index.json`
- passes `transcriptWriter` through to the runner

### `crossfire resume`

Key behavior:

- loads prior events via `EventStore.loadSegments()`
- projects state to find the resume point
- creates a new segment file
- supports profile overrides
- only honors `--judge` if the original run already had a judge profile

### `crossfire replay`

Current implementation delegates to TUI replay logic, but the command itself is not a full interactive replay shell.

### `crossfire status`

Reads `index.json` and prints summary information. Current special-casing for truly in-progress debates is limited.

## Wiring Modules

### createAdapters()

- starts sessions for resolved roles
- closes already-started adapters if setup fails
- exposes `closeAll()`

### createBus()

- optionally creates `EventStore`
- optionally creates `TranscriptWriter`
- can wrap an `existingBus` for resume workflows

Persistence responsibilities are split:

- `EventStore` writes JSONL event segments plus `index.json`
- `TranscriptWriter` writes `transcript.md` / `transcript.html`
- runner synthesis writes `action-plan.md` / `action-plan.html`

### createTui()

- returns `{ store, source }` or `null`
- does not own Ink unmount behavior

## Error Handling

Common CLI failure modes:

- missing or invalid profiles
- invalid numeric options
- adapter start failure
- resume on already completed debates
- user interrupt via `Ctrl+C`
