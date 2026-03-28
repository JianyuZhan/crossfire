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
- **Real-time TUI** — Split-panel terminal UI with live streaming, thinking indicators, tool-call traces, and convergence metrics
- **Event sourcing** — Every event is persisted to JSONL. Resume interrupted debates and replay completed ones from the same source of truth
- **Structured extraction** — Agents report stance, confidence, key points, and concessions via tool calls (Zod-validated)
- **Judge arbitration** — Optional judge agent scores arguments, detects stagnation, and emphasizes evidence responsibility instead of rewarding unsupported claims
- **Adaptive final synthesis** — After the debate, Crossfire generates a final action plan in a fresh synthesis session with local fallback if model-backed synthesis fails
- **Incremental prompts** — Turn 1 sends full context; Turn 2+ sends only new opponent/judge messages, leveraging provider session memory for ~O(1) per-turn cost
- **Profiles** — YAML frontmatter + Markdown system prompts. Built-in proposer/challenger/judge profiles include role-specific research and evidence-handling guidance

## Best For

- **Architecture review** — Pressure-test design proposals, trade-offs, and migration plans
- **Product decisions** — Surface hidden assumptions before committing to a roadmap or bet
- **Risk discovery** — Force explicit concessions, counterarguments, and unresolved concerns
- **Research synthesis** — Turn competing perspectives into a structured action plan in one terminal workflow

## What You Get

- **Live debate view** — Full-screen terminal UI for round-by-round reasoning, judge feedback, and convergence tracking
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

In the example above, output lands in `run_output/microservices/` because `--output run_output/microservices` is set explicitly. If you omit `--output`, Crossfire writes to the default `run_output/debate-<ts>/` directory. Inspect `action-plan.html` or `action-plan.md` there, use `crossfire status <output-dir>` for a summary, and `crossfire replay <output-dir>` to replay the event log.

## TUI

The terminal UI is a full-screen Ink (React for CLI) application with four stacked regions:

- **Header bar** — Centered branding, debate ID, round/phase, proposer & challenger agent info, and topic
- **Scrollable content** — Round-by-round display of agent messages, thinking traces, and tool calls. Scroll with arrow keys, `Ctrl+U`/`Ctrl+D`, or `Home`/`End`
- **Metrics bar** — Per-agent token counts and costs, convergence progress bar with percentage, judge verdict, and scroll status (LIVE / SCROLLED). Usage accounting is provider-aware, so some providers are normalized from cumulative usage before display
- **Command input** — Context-aware live prompt (`>`, `approval>`) for runtime commands

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
| `--output <dir>`              | Output directory                                         | `run_output/debate-<ts>` |
| `--headless`                  | Disable TUI (completion info still printed to stdout)    | `false`                  |
| `-v, --verbose`               | Verbose logging                                          | `false`                  |

> **Validation rules:** `--judge-every-n-rounds` must be less than `--max-rounds`. `--convergence-threshold` must be between 0 and 1.

**Model resolution:** `--proposer-model` > `--model` > profile `model` field > provider default.

### `crossfire resume <output-dir>`

Resume an interrupted debate. State is reconstructed from persisted events.

| Option                   | Description                 | Default           |
| ------------------------ | --------------------------- | ----------------- |
| `--proposer <profile>`   | Override proposer profile   | from `index.json` |
| `--challenger <profile>` | Override challenger profile | from `index.json` |
| `--judge <profile>`      | Override judge profile      | from `index.json` |
| `--headless`             | Disable TUI                 | `false`           |

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
  Proposer: proposer (claude_code)
    Model: claude-sonnet-4-20250514
  Challenger: challenger (codex)
    Model: o3-mini
  Judge: judge (claude_code)
    Model: claude-sonnet-4-20250514

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
| `/inject! proposer <text>`  | High-priority injection (must-address directive) | ✅       |
| `/inject judge <text>`      | Trigger judge immediately with user instruction  | ✅       |
| `/pause`                    | Pause the debate (finishes current turn)         | 🚧 NYI   |
| `/resume`                   | Resume a paused debate                           | 🚧 NYI   |
| `/extend <n>`               | Increase max rounds by N                         | 🚧 NYI   |

> 🚧 **NYI = Not Yet Implemented.** These commands are parsed by the TUI but not yet wired to the orchestrator.

**Approval mode** (auto-activates on tool approval requests): `/approve`, `/deny` ✅

`crossfire resume` currently reuses the TUI without wiring the same inject / approval / stop callbacks exposed by `crossfire start`.

## Supported Agents

| Profile `agent` field | CLI      | Transport                              |
| --------------------- | -------- | -------------------------------------- |
| `claude_code`         | `claude` | In-process Agent SDK ≥0.1.77 (async generator + hooks) |
| `codex`               | `codex`  | Bidirectional JSON-RPC 2.0 over stdio  |
| `gemini_cli`          | `gemini` | Subprocess per turn                    |

Any agent can play any role (proposer, challenger, or judge). Mix and match freely.

## Profiles

Profiles define agent behavior using YAML frontmatter + a Markdown system prompt:

```yaml
---
name: my_debater
description: A skilled technical debater
agent: claude_code
model: claude-sonnet-4-20250514
inherit_global_config: true
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-filesystem"]
---
## Your Role

You are a skilled debater. Present clear arguments backed by evidence.
Use the debate_meta tool to report your stance after each response.
```

| Field                   | Description                                       | Required | Default          |
| ----------------------- | ------------------------------------------------- | -------- | ---------------- |
| `name`                  | Profile identifier                                | yes      | —                |
| `description`           | Human-readable description                        | no       | —                |
| `agent`                 | Agent type (`claude_code`, `codex`, `gemini_cli`) | yes      | —                |
| `model`                 | Preferred model                                   | no       | provider default |
| `inherit_global_config` | Merge user's global MCP config                    | no       | `true`           |
| `mcp_servers`           | Profile-specific MCP servers                      | no       | `{}`             |

**Search paths:** `./profiles/` then `~/.config/crossfire/profiles/`

**Judge auto-inference:** When `--judge` is omitted, Crossfire picks the judge profile matching the proposer's adapter type (for example, `claude/proposer` defaults to `claude/judge`).

Built-in role contracts are intentionally asymmetric:

- proposer and challenger profiles include research requirements so important claims are grounded in code or other available evidence
- challenger profiles are expected to verify key rebuttals and offer concrete alternatives, not just object
- judge profiles prioritize evidence responsibility and should score unsupported claims down instead of doing broad replacement analysis

Built-in profiles:

```text
profiles/
├── claude/    # proposer.md, challenger.md, judge.md
├── codex/     # proposer.md, challenger.md, judge.md
└── gemini/    # proposer.md, challenger.md, judge.md
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

If model-backed synthesis fails, Crossfire still writes a fallback action plan so the run produces a usable report. The fallback report is enriched from the debate summary rather than relying only on sparse draft state.

## How It Works

1. **Profile loading** — CLI reads YAML profiles, validates with Zod, and maps `agent` to adapter type.
2. **Adapter creation** — Each role gets an `AgentAdapter` that normalizes provider-specific protocols into a shared event stream.
3. **Event bus** — All events flow through `DebateEventBus`. The TUI, EventStore (JSONL persistence), and TranscriptWriter all subscribe here.
4. **Turn loop** — The orchestrator builds prompts from projected state, sends them to the active agent, waits for `turn.completed`, then continues with the other side. State is re-projected from events before every decision.
5. **Structured extraction** — Agents call `debate_meta` to report stance, confidence, key points, and concessions. The judge calls `judge_verdict` with scores and continue/stop recommendations, with prompt guidance that penalizes unsupported claims rather than quietly accepting them.
6. **Incremental prompts** — Turn 1 sends the full system prompt, topic, and output schema; subsequent turns send only the opponent's latest response plus optional judge feedback.
7. **Convergence** — Crossfire tracks stance delta, concessions, and whether both sides want to conclude. Debates can terminate early when convergence is high enough.
8. **Persistence** — Events batch-flush to JSONL every 100ms, with sync flush on turn/debate completion. The full log enables deterministic replay and resume.
9. **Final synthesis** — After the debate, Crossfire generates `action-plan.md` / `action-plan.html` in a fresh synthesis session, records synthesis diagnostics for auditing, and falls back to an enriched local report if model-backed synthesis fails.

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
└── cli/                 # Commander.js entry, YAML profile system, wiring factories
```

Layer guide:

- **Adapters** normalize provider protocols into shared events with explicit capability surfaces. Shared type aliases (`AdapterId`, `DebateRole`, `UsageSnapshot`) reduce duplication across the event model.
- **Orchestrator core** makes replay-safe decisions from projected state
- **Orchestrator** runs debates, persists events, writes transcripts, and triggers final synthesis. Key helpers (`getLatestTurnContent`, `invokeJudge`, `applyRoundToPlan`) keep the runner and plan accumulator focused and testable.
- **TUI** renders the same event stream used by live execution and replay. Data-driven lookup maps replace nested ternaries for status icons, prefixes, and color selection.

## Current Limitations

- `crossfire replay` is currently non-interactive and does not expose the live command parser
- `crossfire resume` does not currently wire inject / approval / stop callbacks like `crossfire start`
- Some TUI commands are parsed but not yet wired to orchestrator behavior
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
