<p align="center">
  <img src="assets/logo.png" alt="Crossfire Logo" width="600">
  <h1 align="center">Crossfire</h1>
  <p align="center">
    <strong>AI Adversarial Debate Engine</strong> — Pit two AI agents against each other in structured debates for better decisions.
  </p>
  <p align="center">
    <a href="./README.zh-CN.md">中文</a>&nbsp;&nbsp;|&nbsp;&nbsp;English
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
    <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+">
  </p>
</p>

---

Crossfire orchestrates structured **proposer vs. challenger** debates between any combination of **Claude**, **Codex**, and **Gemini** agents. It tracks stance convergence in real time, optionally invokes a judge to evaluate arguments, and renders everything in a rich terminal UI.

Use it to stress-test proposals, explore trade-offs, or generate high-quality analysis on any topic — all from a single terminal.

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [TUI](#tui)
- [CLI Reference](#cli-reference)
- [Runtime Commands](#runtime-commands)
- [Supported Agents](#supported-agents)
- [Profiles](#profiles)
- [Output Files](#output-files)
- [How It Works](#how-it-works)
- [Architecture Overview](#architecture-overview)
- [Contributing](#contributing)

## Highlights

- **Multi-provider** — Mix and match Claude (Agent SDK), Codex (JSON-RPC), and Gemini (subprocess) in any role
- **Real-time TUI** — Split-panel terminal UI with live streaming, thinking indicators, tool-call traces, and convergence metrics
- **Event sourcing** — Every event is persisted to JSONL. Resume interrupted debates, replay completed ones at any speed
- **Structured extraction** — Agents report stance, confidence, key points, and concessions via tool calls (Zod-validated)
- **Judge arbitration** — Optional judge agent scores arguments, detects stagnation, and can end debates early
- **Bounded prompts** — 4-layer prompt architecture keeps token usage roughly constant across rounds (no O(n²) growth)
- **Profiles** — YAML frontmatter + Markdown system prompts. Customize behavior, model, and MCP servers per role

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
crossfire --version                   # verify
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

```bash
# Claude vs Claude (judge auto-inferred)
crossfire start \
  --topic "Should we adopt microservices?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --max-rounds 5

# Cross-provider: Claude vs Codex with Gemini judge
crossfire start \
  --topic "Is caching always better than recomputing?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --judge gemini/judge

# Read topic from file, no judge
crossfire start \
  --topic-file proposal.md \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --judge none

# Headless mode (no TUI, events still persisted)
crossfire start \
  --topic "Quick brainstorm" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --headless -v
```

## TUI

The terminal UI shows a real-time split-panel view of the debate:

```
┌─ StatusBar ──────────────────────────────────────────────────┐
│ Crossfire — Round 3/10 — proposer-turn                       │
├──────────────────────────────┬───────────────────────────────┤
│  Proposer (claude)           │  Challenger (codex)            │
│  ◉ Speaking...               │  ○ Idle                        │
│                              │                               │
│  [thinking...]               │  Last response:               │
│  The key advantage of...     │  While caching improves...    │
│                              │                               │
│  ▸ Read(src/cache.ts) ✓     │                               │
│  ▸ Grep("TTL") running...   │                               │
├──────────────────────────────┴───────────────────────────────┤
│ Round 2/10 │ Conv: [====------] 35% │ P[agree 0.8] ↔        │
│ C[disagree 0.7] d=0.45 │ Judge: P7:C5 │ Tokens: 12.4k      │
├──────────────────────────────────────────────────────────────┤
│ > /                                                          │
└──────────────────────────────────────────────────────────────┘
```

- **Agent panels** — Live thinking (dimmed), tool calls, and message output
- **Metrics bar** — Convergence progress, stance tracking, judge scores, token usage
- **Command input** — Context-aware mode switching (normal / approval / replay)

Use `--headless` to skip the TUI. Events are still persisted for later replay.

## CLI Reference

### `crossfire start`

Start a new debate.

| Option                        | Description                                              | Default                  |
| ----------------------------- | -------------------------------------------------------- | ------------------------ |
| `--topic <text>`              | Debate topic                                             | —                        |
| `--topic-file <path>`         | Read topic from file (mutually exclusive with `--topic`) | —                        |
| `--proposer <profile>`        | Proposer profile                                         | _required_               |
| `--challenger <profile>`      | Challenger profile                                       | _required_               |
| `--judge <profile\|none>`     | Judge profile, or `none` to disable                      | Auto-inferred            |
| `--max-rounds <n>`            | Maximum rounds                                           | `10`                     |
| `--judge-every-n-rounds <n>`  | Judge evaluation interval                                | `3`                      |
| `--convergence-threshold <n>` | Convergence sensitivity (0–1)                            | `0.3`                    |
| `--model <model>`             | Model override for all roles                             | —                        |
| `--proposer-model <model>`    | Model override for proposer                              | —                        |
| `--challenger-model <model>`  | Model override for challenger                            | —                        |
| `--judge-model <model>`       | Model override for judge                                 | —                        |
| `--output <dir>`              | Output directory                                         | `run_output/debate-<ts>` |
| `--headless`                  | Disable TUI                                              | `false`                  |
| `-v, --verbose`               | Verbose logging                                          | `false`                  |

**Model resolution:** `--proposer-model` > `--model` > profile `model` field > provider default.

### `crossfire resume <output-dir>`

Resume an interrupted debate. State is reconstructed from persisted events.

| Option                   | Description                 | Default          |
| ------------------------ | --------------------------- | ---------------- |
| `--proposer <profile>`   | Override proposer profile   | from `meta.json` |
| `--challenger <profile>` | Override challenger profile | from `meta.json` |
| `--judge <profile>`      | Override judge profile      | from `meta.json` |
| `--headless`             | Disable TUI                 | `false`          |

### `crossfire replay <output-dir>`

Replay a completed debate with time-scaled playback. No agent connections needed.

| Option             | Description               | Default   |
| ------------------ | ------------------------- | --------- |
| `--speed <n>`      | Playback speed multiplier | `1`       |
| `--from-round <n>` | Start from round          | beginning |

### `crossfire status <output-dir>`

Show debate status summary. Add `--json` for machine-readable output.

```
Debate: d-20260321-143022
Topic:  Should we adopt microservices?
Rounds: 8/10
Events: 4523
Duration: 127.3s
Ended:  convergence
Segments: 1
```

## Runtime Commands

During a live debate, type commands in the TUI input bar:

| Command                     | Effect                                           |
| --------------------------- | ------------------------------------------------ |
| `/pause`                    | Pause the debate (finishes current turn)         |
| `/resume`                   | Resume a paused debate                           |
| `/stop`                     | Stop immediately                                 |
| `/inject proposer <text>`   | Add context to proposer's next prompt            |
| `/inject challenger <text>` | Add context to challenger's next prompt          |
| `/inject! proposer <text>`  | High-priority injection (must-address directive) |
| `/inject judge <text>`      | Trigger judge immediately with user instruction  |
| `/extend <n>`               | Increase max rounds by N                         |

**Approval mode** (auto-activates on tool approval requests): `/approve`, `/deny`

**Replay mode**: `/speed <n>`, `/pause`, `/resume`, `/jump round <n>`

## Supported Agents

| Profile `agent` field | CLI      | Transport                              |
| --------------------- | -------- | -------------------------------------- |
| `claude_code`         | `claude` | In-process Agent SDK (async generator) |
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

**Judge auto-inference:** When `--judge` is omitted, Crossfire picks the judge profile matching the proposer's adapter type (e.g., `claude/proposer` defaults to `claude/judge`). Use `--judge none` to disable.

Built-in profiles:

```
profiles/
├── claude/    # proposer.md, challenger.md, judge.md
├── codex/     # proposer.md, challenger.md, judge.md
└── gemini/    # proposer.md, challenger.md, judge.md
```

## Output Files

Each debate produces files in its output directory:

| File            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `events.jsonl`  | Complete event log (one JSON per line) — source of truth |
| `index.json`    | Metadata, byte offsets, segment manifest                 |
| `meta.json`     | Debate config, profile mapping, versions                 |
| `transcript.md` | Human-readable Markdown transcript                       |

On resume, a new segment file is created (e.g., `events-resumed-<ts>.jsonl`) and tracked in `index.json`.

## How It Works

1. **Profile loading** — CLI reads YAML profiles, validates with Zod, maps `agent` to adapter type.

2. **Adapter creation** — Each role gets an `AgentAdapter` wrapping three different protocols (SDK, JSON-RPC, subprocess) into a unified `NormalizedEvent` stream (16 event kinds).

3. **Event bus** — All events flow through `DebateEventBus`. The TUI, EventStore (JSONL persistence), and TranscriptWriter all subscribe here.

4. **Turn loop** — The orchestrator builds prompts from projected state → sends to agent → waits for `turn.completed` → repeats for the other side. State is re-projected from events before every decision (pure event sourcing).

5. **Structured extraction** — Agents call `debate_meta` to report stance (5-level), confidence, key points, and concessions. The judge calls `judge_verdict` with scores and continue/stop recommendation.

6. **Bounded prompts** — A 4-layer prompt architecture (stable prefix, long-term memory, local window, turn instructions) keeps token usage roughly constant across rounds.

7. **Convergence** — Computed from stance delta + mutual concessions + both agents wanting to conclude. When convergence exceeds the threshold, the debate ends early.

8. **Persistence** — Events batch-flush to JSONL every 100ms (sync flush on turn/debate completion). The full log enables deterministic replay and resume.

For the full architecture with type definitions, interfaces, and data flow diagrams, see **[docs/architecture.md](docs/architecture.md)**.

> **Note:** `docs/architecture.md` is a comprehensive design reference but may not be 100% in sync with the source code. When in doubt, the source code is authoritative.

## Architecture Overview

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

## Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for development setup, tech stack, testing instructions, project conventions, and how to add a new adapter.

## License

MIT

## Acknowledgments

Built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Ink](https://github.com/vadimdemedes/ink), and [Zod](https://github.com/colinhacks/zod).
