# Execution Modes

> Crossfire's execution-mode model, precedence rules, and provider mappings.

Back to the overview: [overview.md](./overview.md)

See also:

- [Adapter Layer](./adapter-layer.md)
- [Orchestrator](./orchestrator.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

Crossfire reduces approval fatigue by modeling turn execution as a small set of orchestration-level modes instead of exposing only provider-native approval prompts.

The shared model is intentionally asymmetric:

- Crossfire defines the user-facing mode vocabulary
- each adapter maps that vocabulary to its strongest official provider primitive
- provider-native approval extensions are still preserved where they matter, especially for Codex

## Shared Mode Model

Crossfire currently uses:

- role baseline modes: `research`, `guarded`, `dangerous`
- per-turn override modes: `research`, `guarded`, `dangerous`, `plan`

Why `plan` is not a role baseline:

- in debate workflows, `plan` is a special-case preview mode
- most productive proposer / challenger turns still need real reads, searches, or validation
- treating `plan` as a normal baseline would make it too easy to accidentally degrade debate quality into pure reasoning-only turns

## Precedence

Effective turn mode is resolved with this priority:

```text
debate default < role baseline < turn override
```

Current implementation supports:

- debate default via `DebateConfig.executionModes.defaultMode`
- per-role baseline via `DebateConfig.executionModes.roleModes`
- per-turn override via `DebateConfig.executionModes.turnOverrides`

The resolver returns:

- `baselineMode`
- `effectiveMode`
- `source` (`debate-default`, `role-baseline`, or `turn-override`)

The runner emits `turn.mode.changed` before each proposer / challenger turn so the TUI and event log can show which mode actually governed that turn.

## Provider Mapping

### Claude

Claude maps directly to official permission-mode primitives:

- `research` → `dontAsk` + read-only allowlist (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`, `Task`) + `maxTurns: 12`
- `guarded` → `default`
- `dangerous` → `bypassPermissions` + `allowDangerouslySkipPermissions`
- `plan` → `plan`

Implications:

- Claude is the cleanest provider for Crossfire-style orchestration modes
- `research` is quiet by design because non-allowlisted tools are denied instead of prompting
- `research` is also intentionally bounded: Crossfire applies a conservative Claude-side `maxTurns` cap so evidence gathering does not sprawl indefinitely in a single turn
- session- or project-level persistence still flows through approval updates when explicit approvals are used

### Codex

Codex maps modes to approval and sandbox policy combinations:

- `research` → `approvalPolicy: "on-request"` + `sandboxPolicy: { type: "readOnly" }`
- `guarded` → `approvalPolicy: "on-failure"`
- `dangerous` → `approvalPolicy: "never"` + `sandboxPolicy: { type: "danger-full-access" }`
- `plan` → same conservative mapping as `research` for now

Important nuance:

- Codex is not a single permission-mode provider
- the real leverage comes from policy + sandbox + native approval choices such as `acceptForSession`
- Crossfire must not flatten Codex-native approval options into plain allow / deny

### Gemini

Gemini currently only gets startup / per-turn approval-profile mapping in the headless adapter:

- `research` → `--approval-mode plan`
- `guarded` → default CLI behavior
- `dangerous` → `--approval-mode yolo`
- `plan` → `--approval-mode plan`

Important limitation:

- Gemini headless does not provide approval round-trips comparable to Claude or Codex
- therefore mode support here is a best-effort startup mapping, not feature parity
- policy-engine integration remains the future path for more useful low-interaction research behavior

## CLI Entry Points

`crossfire start` now accepts:

- `--mode <research|guarded|dangerous>`
- `--proposer-mode <research|guarded|dangerous>`
- `--challenger-mode <research|guarded|dangerous>`
- repeatable `--turn-mode <turnId=mode>` where mode can also be `plan`

Examples:

```bash
crossfire start \
  --topic "Should we migrate to Rust?" \
  --proposer claude/proposer \
  --challenger codex/challenger \
  --proposer-mode research \
  --challenger-mode guarded
```

```bash
crossfire start \
  --topic "Should we adopt feature flags?" \
  --proposer claude/proposer \
  --challenger claude/challenger \
  --proposer-mode research \
  --turn-mode p-1=plan
```

## Event and UI Implications

Relevant surfaces:

- adapter-core: `StartSessionInput.executionMode`, `TurnInput.executionMode`
- orchestrator-core: `DebateConfig.executionModes`, `resolveExecutionMode()`, `turn.mode.changed`
- TUI: live panels show the current effective mode in the header/status text

This keeps the event log explicit about mode decisions instead of forcing operators to infer them from provider-side behavior.
