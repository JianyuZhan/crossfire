<p align="center">
  <img src="assets/logo.png" alt="Crossfire Logo" width="600">
  <h1 align="center">Crossfire</h1>
  <p align="center">
    <strong>Multi-Agent Debate CLI for Actionable Decision Support</strong> — Turn structured AI debate into action plans, trade-offs, and risks.
  </p>
  <p align="center">
    <a href="./README.zh-CN.md">中文</a>&nbsp;&nbsp;|&nbsp;&nbsp;English
  </p>
  <p align="center">
    <a href="https://github.com/JianyuZhan/crossfire/actions/workflows/ci.yml"><img src="https://github.com/JianyuZhan/crossfire/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
    <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+">
  </p>
</p>

---

Crossfire is a terminal-first **multi-agent debate orchestrator** for decision support. It runs structured **proposer vs. challenger** debates across **Claude**, **Codex**, and **Gemini**, then synthesizes the result into a prioritized action plan in Markdown and HTML.

Use it to stress-test architecture proposals, migration plans, product bets, and incident responses. The debate is the mechanism; the main deliverable is the final action plan, backed by transcripts and replayable event logs.

## Table of Contents

- [Highlights](#highlights)
- [Best For](#best-for)
- [What You Get](#what-you-get)
- [Quick Start](#quick-start)
- [Execution Modes](#execution-modes)
- [TUI](#tui)
- [CLI Reference](#cli-reference)
- [Runtime Commands](#runtime-commands)
- [Supported Agents](#supported-agents)
- [Profiles](#profiles)
- [Output Files](#output-files)
- [How It Works](#how-it-works)
- [System Model](#system-model)
- [Architecture Overview](#architecture-overview)
- [Current Limitations](#current-limitations)
- [Extending Crossfire](#extending-crossfire)
- [Contributing](#contributing)

## Highlights

- **Action-plan first** — The primary output is `action-plan.html` / `action-plan.md`, not just a debate transcript
- **Multi-provider** — Mix and match Claude (Agent SDK), Codex (JSON-RPC), and Gemini (subprocess) in any role
- **Real-time TUI** — Split-panel terminal UI with live streaming, retained thinking summaries, persistent pre-tool narration blocks, wrapped tool-call traces, locally tracked live tool elapsed timers, highlighted approval cards, and convergence metrics
- **Event sourcing** — Every event is persisted to JSONL. Resume interrupted debates and replay completed ones from the same source of truth
- **Structured extraction** — Agents report stance, confidence, key points, and concessions via tool calls (Zod-validated)
- **Judge arbitration** — Optional judge agent scores arguments, detects stagnation, and emphasizes evidence responsibility instead of rewarding unsupported claims
- **Adaptive final synthesis** — After the debate, Crossfire generates a final action plan in a fresh synthesis session, forces synthesis into a tool-free planning turn, and falls back to a structured local report if model-backed synthesis fails
- **Incremental prompts** — Turn 1 sends full context; Turn 2+ sends only new opponent/judge messages, leveraging provider session memory for ~O(1) per-turn cost
- **Profiles + prompt templates** — Built-in provider profiles now hold agent/model/runtime config, while reusable `general` and `code` prompt templates define the role contract
- **Execution modes** — Set debate defaults, per-role baselines, and per-turn overrides such as `research`, `guarded`, `dangerous`, and `plan`

## Best For

- **Architecture review** — Pressure-test design proposals, trade-offs, and migration plans
- **Product decisions** — Surface hidden assumptions before committing to a roadmap or bet
- **Risk discovery** — Force explicit concessions, counterarguments, and unresolved concerns
- **Research synthesis** — Turn competing perspectives into a structured action plan in one terminal workflow

## What You Get

- **Live debate view** — Full-screen terminal UI for round-by-round reasoning, retained thinking summaries, persistent pre-tool narration, wrapped tool details, locally tracked live tool elapsed timers, approval prompts, judge feedback, and convergence tracking
- **Action plan outputs** — Final report in Markdown and HTML for sharing, editing, or automation
- **Full transcript** — Human-readable transcript in Markdown and HTML
- **Replayable audit trail** — Event-sourced JSONL logs plus `index.json` metadata for replay, resume, and status inspection

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- At least one agent CLI installed: [`claude`](https://docs.anthropic.com/en/docs/claude-code), [`codex`](https://github.com/openai/codex), or [`gemini`](https://github.com/google-gemini/gemini-cli)

## Install

```bash
git clone https://github.com/jyzhan/crossfire.git
cd crossfire
pnpm install
pnpm build
```

**Option A: Global command (recommended)**

```bash
pnpm setup                           # ensures PNPM_HOME is in PATH (restart terminal after)
pnpm -C packages/cli link --global   # makes `crossfire` available globally
crossfire --version                  # verify
```

> If `pnpm setup` reports "already up to date" but `crossfire` is not found, add pnpm's global bin to your PATH manually:
>
> ```bash
> echo 'export PNPM_HOME="$HOME/Library/pnpm"' >> ~/.zshrc  # macOS
> echo 'export PATH="$PNPM_HOME:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

**Option B: Run directly (no global install needed)**

```bash
node packages/cli/dist/index.js <command> [options]
```

## Quick Start

Before your first run, make sure the agent CLI used by your selected profiles is installed, authenticated, and works in your shell.

```bash
# Claude vs Claude (judge auto-inferred)
crossfire start \
  --topic "Should we adopt microservices?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --max-rounds 5 \
  --output run_output/microservices

# Cross-provider: Claude vs Codex with Gemini judge
crossfire start \
  --topic "Is caching always better than recomputing?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --judge gemini/judge

# Headless mode (no TUI, completion info still printed to stdout)
crossfire start \
  --topic "Quick brainstorm" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --headless -v
```

In the example above, output lands in `run_output/microservices/` because `--output run_output/microservices` is set explicitly. If you omit `--output`, Crossfire writes to a timestamped debate directory such as `run_output/d-20260331-224500/`. Inspect `action-plan.html` or `action-plan.md` there, use `crossfire status <output-dir>` for a summary, and `crossfire replay <output-dir>` to replay the event log.

## Execution Modes

Execution modes are Crossfire's way to reduce approval fatigue without flattening every provider into the same approval protocol.

Think of them as an orchestration-level policy layer:

- Crossfire decides how interactive a turn should be
- each adapter maps that decision to the strongest official primitive the provider actually exposes
- the event log and TUI record which mode was really used for each turn

There are three baseline modes and one special override:

- `research`
  Low-interaction research. Prefer safe or read-oriented behavior and reduce approval noise.
  For Claude, this also applies a conservative per-turn query cap so one research turn does not keep expanding forever.
- `guarded`
  Normal controlled execution. This is the closest thing to the old default behavior.
- `dangerous`
  High-trust execution. Minimize approval interruptions and accept higher risk.
- `plan`
  Per-turn special mode. Use it when you want an agent to outline what it intends to do before giving it a more permissive execution mode.

Why `plan` is not a normal baseline:

- debate quality usually depends on real reads, searches, and verification
- a permanent `plan` baseline would turn many turns into pure LLM reasoning with weaker evidence
- in practice, `plan` is most useful as a one-turn preview, not as a steady-state runtime mode

Mode precedence is:

```text
debate default < role baseline < turn override
```

That means:

- `--mode` sets the debate-wide default
- `--proposer-mode` and `--challenger-mode` override the default for one role
- `--turn-mode p-1=plan` or `--turn-mode c-2=dangerous` wins for that one turn only

Examples:

```bash
# Debate-wide default
crossfire start \
  --topic "Should we migrate to Rust?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --mode guarded
```

```bash
# Different baselines by role
crossfire start \
  --topic "Should we rebuild the auth service?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --proposer-mode research \
  --challenger-mode guarded
```

```bash
# Force a one-turn planning preview before proposer round 1
crossfire start \
  --topic "Should we move to event sourcing?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --proposer-mode research \
  --turn-mode p-1=plan
```

Current provider mapping is intentionally asymmetric:

- **Claude**
  `research -> dontAsk + allowlist + bounded maxTurns`, `guarded -> default`, `dangerous -> bypassPermissions`, `plan -> plan`
- **Codex**
  maps to approval and sandbox policy combinations rather than a single mode field
- **Gemini**
  currently only gets startup / per-turn approval-profile mapping in headless mode; do not assume parity with Claude or Codex

Practical guidance:

- start with `proposer-mode research` when the proposer tends to do broad evidence gathering
- for Claude, `research` is intentionally bounded; if you need a longer free-form exploration turn, step up to `guarded` or `dangerous`
- keep `challenger-mode guarded` when you still want explicit control over stronger validation actions
- use `--turn-mode p-1=plan` when you want to inspect the agent's intended workflow before letting it execute
- use `dangerous` only for trusted, well-bounded tasks where interruption cost matters more than reviewability

## TUI

The terminal UI is a full-screen Ink (React for CLI) application with four stacked regions:

- **Header bar** — Centered branding, debate ID, round/phase, proposer & challenger agent info, and topic
- **Scrollable content** — Round-by-round display of agent messages, thinking traces, and wrapped tool calls so long commands and inputs stay readable. Scroll with arrow keys, `Ctrl+U`/`Ctrl+D`, or `Home`/`End`
- **Tool liveness** — Running tool rows and live headers show a locally maintained elapsed timer even when the provider only emits `tool.call` / `tool.result` without intermediate `tool.progress` events
- **Metrics bar** — Per-agent token counts and costs, convergence progress bar with percentage, judge verdict, and scroll status (LIVE / SCROLLED). Usage accounting is provider-aware, and token rows now label whether a provider reports `session delta`, `per turn`, or `thread cumulative` usage
- **Fixed live status** — The metrics bar reserves its first line for a compact `Active: ...` summary of the currently running role, so long tool bursts stay visible even after the round header scrolls out of the live viewport
- **Compressed tool failures** — Live tool views collapse repeated fetch failures into a short summary such as `recent failures: 404×5, 403×2`; use `run_output/<debate-id>/events.jsonl` for the full raw trace
- **Live tool focus** — The live panel only keeps currently running tools on screen. Successful tools disappear from the live list as soon as they finish, while failures collapse into a short summary; completed details remain available in round snapshots and `events.jsonl`
- **Six-state Claude tool model** — Claude tool requests are projected as `requested`, `running`, `succeeded`, `failed`, `denied`, or `unknown` rather than assuming every `tool.call` is already executing. A provider `tool.progress` upgrades a request into `running`, permission denials collapse into `denied`, and only observed terminal hooks become `succeeded` / `failed`
- **Unresolved tool closure** — If a turn ends while some provider tool requests never produce a terminal hook, Crossfire closes those live rows as `unknown outcome` instead of letting them sit in `running` forever
- **Command/approval area** — Context-aware live prompt (`>`, `approval>`) plus expanded approval cards that show the pending tool/command, batch actions, and provider-aware shortcuts such as `/approve 2`, `/approve 2 2`, or `/approve all`
- **Mode visibility** — Proposer and challenger headers append the effective turn mode inline as `Role [provider] [mode: ...]`, so you can tell at a glance whether a role is in `research`, `guarded`, `dangerous`, or `plan` without hunting for a separate status line

Use `--headless` to skip the TUI. Events and synthesis outputs are still persisted for later inspection.

## CLI Reference

### `crossfire start`

Start a new debate.

| Option                        | Description                                              | Default                  |
| ----------------------------- | -------------------------------------------------------- | ------------------------ |
| `--topic <text>`              | Debate topic                                             | —                        |
| `--topic-file <path>`         | Read topic from file (mutually exclusive with `--topic`) | —                        |
| `--proposer <profile>`        | Proposer profile                                         | _required_               |
| `--challenger <profile>`      | Challenger profile                                       | _required_               |
| `--judge <profile>`           | Judge profile (default: inferred from proposer)          | Auto-inferred            |
| `--max-rounds <n>`            | Maximum debate rounds before forced termination          | `10`                     |
| `--judge-every-n-rounds <n>`  | Judge intervenes every N rounds (must be < max-rounds)   | `3`                      |
| `--convergence-threshold <n>` | Stance distance (0-1) below which debate auto-converges  | `0.3`                    |
| `--model <model>`             | Model override for all roles                             | —                        |
| `--proposer-model <model>`    | Model override for proposer                              | —                        |
| `--challenger-model <model>`  | Model override for challenger                            | —                        |
| `--judge-model <model>`       | Model override for judge                                 | —                        |
| `--mode <mode>`               | Debate default execution mode (`research`, `guarded`, `dangerous`) | —            |
| `--proposer-mode <mode>`      | Proposer baseline execution mode                         | —                        |
| `--challenger-mode <mode>`    | Challenger baseline execution mode                       | —                        |
| `--turn-mode <turnId=mode>`   | Repeatable per-turn override; supports `plan`           | —                        |
| `--template <family>`         | Prompt template family for all roles (`auto`, `general`, `code`) | `auto` |
| `--proposer-template <family>` | Proposer prompt template override                      | inherited from `--template` |
| `--challenger-template <family>` | Challenger prompt template override                 | inherited from `--template` |
| `--judge-template <family>`   | Judge prompt template override                           | inherited from `--template` |
| `--output <dir>`              | Output directory                                         | `run_output/d-YYYYMMDD-HHMMSS` |
| `--headless`                  | Disable TUI (completion info still printed to stdout)    | `false`                  |
| `-v, --verbose`               | Verbose logging                                          | `false`                  |

> **Validation rules:** `--judge-every-n-rounds` must be less than `--max-rounds`. `--convergence-threshold` must be between 0 and 1.

Execution mode precedence is:

```text
debate default < role baseline < turn override
```

**Model resolution:** `--proposer-model` > `--model` > profile `model` field > provider default.

### `crossfire resume <output-dir>`

Resume an interrupted debate. State is reconstructed from persisted events.

| Option                   | Description                 | Default           |
| ------------------------ | --------------------------- | ----------------- |
| `--proposer <profile>`   | Override proposer profile   | from `index.json` |
| `--challenger <profile>` | Override challenger profile | from `index.json` |
| `--judge <profile>`      | Override judge profile      | from `index.json` |
| `--headless`             | Disable TUI                 | `false`           |

`--judge` is only honored if the original debate already had a judge profile. Resume cannot add a brand-new judge to a run that started without one.

### `crossfire replay <output-dir>`

Replay a completed debate with time-scaled playback. No agent connections needed.

| Option             | Description               | Default   |
| ------------------ | ------------------------- | --------- |
| `--speed <n>`      | Playback speed multiplier | `1`       |
| `--from-round <n>` | Start from round          | beginning |

> **Current behavior:** replay is currently CLI-driven and non-interactive. It replays the stored event stream, but does not expose the live command parser.

### `crossfire status <output-dir>`

Show debate status summary. Add `--json` for machine-readable output.

```text
Debate Status
=============

Debate ID: d-20260321-143022
Topic: Should we adopt microservices?
Started: 2026-03-21T14:30:22.000Z
Ended: 2026-03-21T14:32:29.300Z
Duration: 2m 7s

Total Rounds: 8
Total Events: 4523
Termination Reason: convergence

Profiles:
  Proposer: claude_proposer (claude_code)
    Model: us.anthropic.claude-opus-4-6-v1
  Challenger: codex_challenger (codex)
    Model: gpt-5.1-codex-mini
  Judge: claude_judge (claude_code)
    Model: us.anthropic.claude-opus-4-6-v1

Configuration:
  Max Rounds: 10
  Judge Every N Rounds: 3
  Convergence Threshold: 0.3
```

## Runtime Commands

During a live debate started with `crossfire start`, type commands in the TUI input bar:

| Command                     | Effect                                           | Status   |
| --------------------------- | ------------------------------------------------ | -------- |
| `/stop`                     | Stop immediately                                 | ✅       |
| `/inject proposer <text>`   | Add context to proposer's next prompt            | ✅       |
| `/inject challenger <text>` | Add context to challenger's next prompt          | ✅       |
| `/inject both <text>`       | Add context to both agents' next prompts         | ✅       |
| `/inject! <target> <text>`  | High-priority injection for `proposer`, `challenger`, or `both` | ✅ |
| `/inject judge <text>`      | Queue an out-of-band judge turn after the current round with user instruction | ✅ |
| `/interrupt [role]`         | Interrupt the active provider turn when supported | ✅       |
| `/pause`                    | Pause the debate after the current turn          | ✅       |
| `/resume`                   | Resume a paused live debate                      | ✅       |
| `/extend <n>`               | Increase max rounds by N                         | ✅       |

**Approval mode** (auto-activates on approval requests): `/approve`, `/deny`, `/approve <index>`, `/deny <index>`, `/approve <index> <option>`, `/deny <index> <option>`, `/approve all`, `/deny all` ✅  
The TUI expands pending approvals into a dedicated highlighted block with the provider, approval type, request summary, per-row index shortcuts, provider-aware option rows, and batch approve / reject commands. When every pending approval shares the same session-level allow option, the block now surfaces a direct shortcut such as `/approve all 2`. Claude tool approvals always expose a session-level allow option through Crossfire's normalized approval capabilities, while Codex approvals can surface native decision variants when the provider sends them.

`crossfire resume` now reuses the same live command wiring as `crossfire start`, so `/stop`, `/interrupt`, approval commands, inject commands, `/pause`, `/resume`, and `/extend` remain available while resuming an interrupted debate.

Inject semantics:

- proposer / challenger / both injects are one-shot guidance consumed when the next targeted prompt is built
- if you inject the same target multiple times before its next turn, the latest inject replaces the earlier pending one
- `/inject judge` does not interrupt the current speaker mid-turn; it queues an extra judge turn at the next post-round checkpoint

## Supported Agents

| Profile `agent` field | CLI      | Transport                              |
| --------------------- | -------- | -------------------------------------- |
| `claude_code`         | `claude` | In-process Agent SDK ≥0.1.77 (async generator + hooks) |
| `codex`               | `codex`  | Bidirectional JSON-RPC 2.0 over stdio  |
| `gemini_cli`          | `gemini` | Subprocess per turn                    |

Any agent can play any role (proposer, challenger, or judge). Mix and match freely.

## Profiles

Crossfire now separates provider/runtime profiles from reusable role prompts.

Provider profiles are JSON files:

```json
{
  "name": "my_debater",
  "description": "A skilled technical debater",
  "agent": "claude_code",
  "model": "us.anthropic.claude-opus-4-6-v1",
  "prompt_family": "auto",
  "inherit_global_config": true,
  "mcp_servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-filesystem"]
    }
  }
}
```

| Field                   | Description                                       | Required | Default          |
| ----------------------- | ------------------------------------------------- | -------- | ---------------- |
| `name`                  | Profile identifier                                | yes      | —                |
| `description`           | Human-readable description                        | no       | —                |
| `agent`                 | Agent type (`claude_code`, `codex`, `gemini_cli`) | yes      | —                |
| `model`                 | Preferred model                                   | no       | provider default |
| `prompt_family`         | Default prompt family (`auto`, `general`, `code`) | no       | `auto`           |
| `inherit_global_config` | Merge user's global MCP config                    | no       | `true`           |
| `mcp_servers`           | Profile-specific MCP servers                      | no       | `{}`             |

Prompt contracts are plain Markdown files under `prompts/<family>/<role>.md`.

**Search paths:**

- provider profiles: `./profiles/providers/` then `~/.config/crossfire/profiles/providers/`
- prompt templates: `./prompts/` then `~/.config/crossfire/prompts/`

**Judge auto-inference:** When `--judge` is omitted, Crossfire picks the judge profile matching the proposer's adapter type (for example, `claude/proposer` defaults to `claude/judge`).

Built-in prompting is now split into two layers:

- provider profiles choose the adapter, default model, and runtime wiring
- prompt templates define the `proposer`, `challenger`, and `judge` role contract
- template family `general` is for business, product, and research topics
- the built-in proposer templates now force executable plans instead of high-level slogans; `general/proposer` pushes positioning, economics, controls, channel protection, and operations, while `code/proposer` pushes implementation detail, migration, tests, security, and rollout
- the built-in challenger templates now force multi-dimensional challenge coverage instead of generic objections; `general/challenger` pushes trust/conversion, pricing abuse, security/compliance, channel leakage, and execution burden, while `code/challenger` pushes correctness, regression risk, testing, security, operations, and rollout
- the built-in judge templates now penalize shallow risk lists and weak convergence calls; they explicitly look for evidence-backed challenges, concrete failure modes, and unresolved high-leverage gaps
- template family `code` is for repository, implementation, and debugging topics
- `--template auto` runs one lightweight classifier call first, using the judge profile's provider/model to choose between `general` and `code`
- if the classifier times out or returns invalid JSON, Crossfire falls back to a local heuristic
- `--proposer-template`, `--challenger-template`, and `--judge-template` still override the family manually and skip the classifier

This split is now symmetric across Claude, Codex, and Gemini. Built-in provider profiles no longer hard-code provider-specific role prompts. Instead, all built-in providers share the same reusable `general` and `code` role-template families, while adapter/runtime differences stay in the provider profile layer.

Built-in files:

```text
profiles/
└── providers/
    ├── claude/   # proposer.json, challenger.json, judge.json
    ├── codex/    # proposer.json, challenger.json, judge.json
    └── gemini/   # proposer.json, challenger.json, judge.json
prompts/
├── general/      # proposer.md, challenger.md, judge.md
└── code/         # proposer.md, challenger.md, judge.md
```

Typical usage:

```bash
# Let Crossfire classify the template family automatically
crossfire start \
  --topic "Should we launch an API resale product?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --template auto
```

```bash
# Force code-oriented prompting for every role
crossfire start \
  --topic "Should we rewrite the data layer?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --template code
```

```bash
# Use different template families by role
crossfire start \
  --topic "Should we rewrite the data layer?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --proposer-template general \
  --challenger-template code
```

```bash
# Combine role baselines, per-turn execution override, and template selection
crossfire start \
  --topic "Should we rewrite the data layer?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --proposer-mode research \
  --challenger-mode guarded \
  --turn-mode p-1=plan \
  --template code
```

## Output Files

Each debate produces files in its output directory:

| File                   | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `action-plan.html`     | Primary final report in HTML                                                     |
| `action-plan.md`       | Same action plan in Markdown                                                     |
| `transcript.html`      | Full debate transcript in HTML                                                   |
| `transcript.md`        | Same transcript in Markdown                                                      |
| `events.jsonl`         | Complete event log (one JSON per line) — source of truth                         |
| `index.json`           | Metadata, byte offsets, segment manifest, profile info, and debate config        |
| `synthesis-debug.json` | Prompt-assembly metadata plus synthesis runtime diagnostics for inspecting or troubleshooting output |

On resume, a new segment file is created (for example, `events-resumed-<ts>.jsonl`) and tracked in `index.json`.

Visible transcript-style outputs automatically strip embedded `debate_meta` / `judge_verdict` JSON blocks after extraction. The structured payloads remain preserved in `events.jsonl` and derived state.

If model-backed synthesis fails, Crossfire still writes a fallback action plan so the run produces a usable report. The fallback report is enriched from the debate summary rather than relying only on sparse draft state, keeps the executive summary as short structured paragraphs, and avoids dumping the full judge essay into the recommendation line.

## How It Works

1. **Profile loading** — CLI reads JSON provider profiles, validates them with Zod, and maps `agent` to adapter type.
2. **Prompt template resolution** — Crossfire resolves the `general` or `code` template family from `--template`, per-role `--*-template` overrides, profile `prompt_family`, or the lightweight topic classifier fallback, then loads `prompts/<family>/<role>.md`.
3. **Adapter creation** — Each role gets an `AgentAdapter` that normalizes provider-specific protocols into a shared event stream.
4. **Event bus** — All events flow through `DebateEventBus`. The TUI, EventStore (JSONL persistence), and TranscriptWriter all subscribe here.
5. **Turn loop** — The orchestrator builds prompts from projected state, sends them to the active agent, waits for `turn.completed`, then continues with the other side. State is re-projected from events before every decision.
6. **Structured extraction** — Agents call `debate_meta` to report stance, confidence, key points, and concessions. The judge calls `judge_verdict` with scores and continue/stop recommendations, with prompt guidance that penalizes unsupported claims rather than quietly accepting them.
7. **Incremental prompts** — Turn 1 sends the full system prompt, topic, and output schema; subsequent turns send only the opponent's latest response plus optional judge feedback.
8. **Convergence** — Crossfire tracks stance delta, concessions, and whether both sides want to conclude. Debates can terminate early when convergence is high enough.
9. **Persistence** — Events batch-flush to JSONL every 100ms, with sync flush on turn/debate completion. The full log enables deterministic replay and resume.
10. **Final synthesis** — After the debate, Crossfire generates `action-plan.md` / `action-plan.html` in a fresh synthesis session, runs that synthesis turn in tool-free `plan` mode with a longer timeout budget, records synthesis diagnostics for auditing, and falls back to an enriched local report if model-backed synthesis fails.

For the architecture reference set, start at **[docs/architecture/overview.md](docs/architecture/overview.md)**.

> **Note:** The architecture docs are maintained as an entry page plus linked subsystem references. When in doubt, the source code is authoritative.

## System Model

Crossfire is built around a shared event stream rather than mutable runtime state.

- **Event log is authoritative** — Replay, resume, transcript generation, and status reporting all derive from persisted events
- **All state is projected** — Runtime state is rebuilt through `projectState(events[])`, which keeps replay and recovery deterministic
- **Pure core / effectful shell** — `-core` packages hold testable logic, while outer packages handle CLI, adapters, file I/O, and rendering

## Architecture Overview

```text
packages/
├── adapter-core/        # Shared event model, AgentAdapter interface, Zod schemas, contract tests
├── adapter-claude/      # Claude Agent SDK adapter (in-process async generator)
├── adapter-codex/       # Codex JSON-RPC 2.0 bidirectional stdio adapter
├── adapter-gemini/      # Gemini subprocess-per-turn adapter (A→B fallback)
├── orchestrator-core/   # Pure logic: state projection, convergence, prompt building, director
├── orchestrator/        # Side effects: debate runner, DebateEventBus, EventStore, TranscriptWriter, synthesis
├── tui/                 # Ink (React for CLI) components, TuiStore, EventSource/PlaybackClock
└── cli/                 # Commander.js entry, JSON profile system, wiring factories
```

Layer guide:

- **Adapters** normalize provider protocols into shared events with explicit capability surfaces. Shared type aliases (`AdapterId`, `DebateRole`, `UsageSnapshot`) reduce duplication across the event model.
- **Orchestrator core** makes replay-safe decisions from projected state
- **Orchestrator** runs debates, persists events, writes transcripts, and triggers final synthesis. Key helpers (`getLatestTurnContent`, `invokeJudge`, `applyRoundToPlan`) keep the runner and plan accumulator focused and testable.
- **TUI** renders the same event stream used by live execution and replay. Data-driven lookup maps replace nested ternaries for status icons, prefixes, and color selection.

## Current Limitations

- `crossfire replay` is currently non-interactive and does not expose the live command parser
- `/jump turn <turnId>` is parsed by the TUI but does not have a live handler yet
- `crossfire status` still has limited special-casing for truly in-progress debates
- external history injection remains an internal adapter recovery capability; there is no user-facing `--history-file` or live import command yet
- TODO: if external history injection becomes a product feature, prefer `start/resume --history-file <json>` over a live import command so the imported context stays event-sourced and replay-safe
- `replay --from-round` is not reliable across resumed multi-segment runs today

## Extending Crossfire

To add a new provider, implement `AgentAdapter` in a new package, normalize provider output into the shared event model, run the adapter contract tests, then wire adapter creation in the CLI factory layer and add profiles for the new role set.

For design details, start with **[docs/architecture/overview.md](docs/architecture/overview.md)** and then read **[docs/architecture/adapter-layer.md](docs/architecture/adapter-layer.md)** and **[docs/architecture/orchestrator.md](docs/architecture/orchestrator.md)**.

## Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for development setup, tech stack, testing instructions, project conventions, and how to add a new adapter.

## License

MIT

## Acknowledgments

Built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Ink](https://github.com/vadimdemedes/ink), and [Zod](https://github.com/colinhacks/zod).
