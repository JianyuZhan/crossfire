# TUI and CLI

> Rendering, persistence, replay, and command wiring.

Back to the overview: [overview.md](./overview.md)

See also:

- [System Overview](./overview.md)
- [Execution Modes](./execution-modes.md)
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
- the metrics bar labels token semantics such as `session delta`, `per turn`, and `thread cumulative`, because provider usage numbers are not directly comparable unless their reporting basis is visible
- `thinkingText` is front-trimmed to about 4096 characters
- thinking is no longer a purely transient status-only string; the latest retained thinking summary is kept visible while tools/messages stream and can be copied into completed round snapshots
- assistant narration emitted before a tool phase is archived into persistent per-turn narration blocks, so the live panel can keep showing model-authored text even after the status flips to `tool`
- when a live panel is in `tool` state, Crossfire distinguishes `requested`, `running`, `succeeded`, `failed`, `denied`, and `unknown` tool rows instead of treating every `tool.call` as definitely running
- for Claude specifically, `tool.call` is treated as a requested tool intent; only `tool.progress` upgrades that row into `running`
- the live header rolls those states into compact counts plus a locally synthesized active elapsed timer, so long research bursts remain visibly active even when provider tool telemetry is partial
- `plan.updated` and `subagent.*` are projected into live panel state and completed snapshots rather than being dropped on the floor
- visible assistant text is stripped of internal `debate_meta` / `judge_verdict` JSON blocks before rendering
- approval requests retain a short detail summary derived from provider payloads so the operator can see what is waiting before approving it
- pending approvals retain request-scoped approval capabilities from the adapter layer; the TUI derives a displayable option list from `semanticOptions[]` and selected `nativeOptions[]` instead of depending on one flat provider field
- when every pending approval shares the same session-scoped allow choice, the command area surfaces a bulk shortcut such as `/approve all 2` instead of forcing the operator to repeat the same indexed choice row by row
- live proposer / challenger headers now also surface the effective execution mode for the active turn so operators can tell whether a role is currently running in `research`, `guarded`, `dangerous`, or `plan`
- because long tool streams can push the round header outside the scrollable viewport, the fixed metrics bar reserves its first row for the currently active role's compact live status (`thinking`, `responding`, or tool counts / elapsed time / mode)
- repeated live tool failures are intentionally compressed into a short summary (`404×N`, `403×N`, blocked domains, and so on) instead of rendering one failed tool row per occurrence; the full uncompressed trace remains in `run_output/<debate-id>/events.jsonl`
- successful tool rows are transient in the live panel: once a tool finishes successfully, it drops out of the live list so the UI stays focused on active work; completed detail survives in turn snapshots and raw event logs
- unresolved tool rows are also closed at turn end: if a provider emits `tool.call` without any observed terminal hook before `turn.completed`, the TUI converts that row to `unknown outcome` and removes it from live-running counts instead of leaving it active forever
- `tool.denied` and denied approval resolutions are projected as a separate denied terminal state rather than being folded into generic failures

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

Current block-level rendering now includes:

- retained thinking summaries, including `reasoning-summary` vs `raw-thinking` labeling
- plan steps from `plan.updated`
- subagent lifecycle entries from `subagent.started` / `subagent.completed`
- wrapped tool-call lines instead of single-line truncation
- tool-call rows retain a locally updated elapsed timer so UI liveness does not depend on provider-side `tool.progress`
- multi-line approval cards in the fixed command area, with visible index shortcuts, per-option commands, and batch approve / deny hints

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
- `/interrupt`
- `/stop`
- `/pause`
- `/resume`
- `/extend <N>`
- approval commands (`/approve`, `/deny`, `/approve <index>`, `/deny <index>`, `/approve <index> <option>`, `/deny <index> <option>`, `/approve all`, `/deny all`)

Runner-wired commands in `crossfire resume`:

- `/inject`
- `/inject!`
- `/inject judge`
- `/interrupt`
- `/stop`
- `/pause`
- `/resume`
- `/extend <N>`
- approval commands (`/approve`, `/deny`, `/approve <index>`, `/deny <index>`, `/approve <index> <option>`, `/deny <index> <option>`, `/approve all`, `/deny all`)

Parsed but not currently wired:

- `/jump turn <turnId>` is parsed but has no current handler

Important wiring nuance:

- `crossfire start` and `crossfire resume` now share the same live command handler, so stop / interrupt / approval / inject / pause / resume / extend behavior stays aligned across fresh and resumed runs
- `/interrupt` is routed as a control event to the runner, which attempts provider-native `adapter.interrupt(turnId)` only for the currently active turn; unsupported adapters surface a warning instead
- the TUI command status area reflects projected live pause state and expands pending approvals into a taller fixed region so commands stay visible while operator action is required
- `/approve` and `/deny` still work as shorthand defaults, but when an approval exposes request-scoped approval capabilities, the handler can target a specific choice via `/approve <approval-index> <option-index>` or `/deny <approval-index> <option-index>`
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

Profiles are Markdown files with YAML frontmatter. Crossfire now separates provider/runtime config from reusable role prompting.

Key fields:

- `name`
- `description?`
- `agent`
- `model?`
- `prompt_template_family?`
- `inherit_global_config`
- `mcp_servers`

Search paths:

- `./profiles`
- `~/.config/crossfire/profiles`

Built-in prompt resolution is two-layered:

- provider profiles choose the adapter, default model, and runtime wiring
- prompt templates define the built-in `proposer`, `challenger`, and `judge` role contract
- built-in provider profiles typically set `prompt_template_family: auto` and rely on template resolution unless a custom profile embeds its own prompt body
- reusable built-in templates live under `profiles/templates/general/*.md` and `profiles/templates/code/*.md`

Resolution rules:

- if a profile body is non-empty, that embedded system prompt is used by default
- otherwise Crossfire resolves the template family from `--template`, per-role `--*-template` overrides, or topic-based auto inference
- the selected family then loads `templates/<family>/<role>.md`
- this split is symmetric across Claude, Codex, and Gemini; built-in role prompting no longer lives only inside one provider's profile files

## Commands

### `crossfire start`

Key behavior:

- validates topic flags and numeric options
- parses debate / role / per-turn execution mode options
- infers a judge profile from proposer adapter type when not provided
- creates `run_output/${debateId}` by default
- writes the initial `index.json`
- passes `transcriptWriter` through to the runner

Execution-mode CLI entry points:

- `--mode <research|guarded|dangerous>` sets the debate default
- `--proposer-mode <research|guarded|dangerous>` and `--challenger-mode <...>` set role baselines
- repeatable `--turn-mode <turnId=mode>` applies a static per-turn override; `mode` may also be `plan`
- `--template <auto|general|code>` sets the default prompt-template family
- `--proposer-template`, `--challenger-template`, and `--judge-template` override the family per role

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
