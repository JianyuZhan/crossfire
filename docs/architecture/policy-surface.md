# Policy Surface

> Crossfire's policy compilation pipeline, presets, precedence rules, and provider translation.

Back to the overview: [overview.md](./overview.md)

See also:

- [Adapter Layer](./adapter-layer.md)
- [Orchestrator](./orchestrator.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

Crossfire reduces approval fatigue and provider lock-in by modeling turn execution through a layered policy system. Instead of mapping mode strings directly to provider-native parameters, Crossfire compiles a provider-agnostic `ResolvedPolicy` and then translates it into each adapter's native controls.

The compilation pipeline:

```text
PresetInput -> compilePolicy() -> ResolvedPolicy -> adapter translatePolicy() -> ProviderTranslationResult
```

- `PresetInput` carries a preset name (`research`, `guarded`, `dangerous`, `plan`), a role, and optional evidence/interaction overrides
- `compilePolicy()` expands the preset, applies default role contracts, and clamps capabilities to role ceilings
- Each adapter's `translatePolicy()` is a pure function that maps `ResolvedPolicy` to provider-native options plus translation warnings

## Policy Layers

A `ResolvedPolicy` comprises:

- **Role contract**: semantic constraints (exploration, fact-check scope, evidence bar, whether new proposals are allowed)
- **Capability policy**: filesystem, network, shell, subagents levels
- **Interaction policy**: approval mode (`always`, `on-risk`, `on-failure`, `never`) plus optional limits (maxTurns, budgetUsd, timeoutMs, maxToolCalls)
- **Evidence policy**: citation strength requirements (low, medium, high)
- **Preset**: the originating preset name, preserved for diagnostics only -- adapters must not branch on it

## Presets

Crossfire uses these presets as entry points:

- `research` -- read/search oriented, bounded turns, on-risk approval
- `guarded` -- read/write with on-risk approval (the default)
- `dangerous` -- full access, no approval
- `plan` -- read-only reasoning, always-approve (used for judge turns)

Why `plan` is not a role baseline:

- in debate workflows, `plan` is a special-case preview mode
- most productive proposer / challenger turns still need real reads, searches, or validation
- treating `plan` as a normal baseline would make it too easy to accidentally degrade debate quality into pure reasoning-only turns

Judge turns default to the `plan` preset, but the judge baseline can still be overridden through the same shared role-preset resolution path (`--judge-preset` or config role preset).

### Preset Resolution Precedence

The preset for each role is resolved through a 4-level precedence system:

```text
CLI role-specific > CLI global > config file > role default
```

- **CLI role-specific**: `--proposer-preset plan` applies only to proposer turns
- **CLI global**: `--preset guarded` applies to all roles unless overridden
- **Config file**: `roles.proposer.preset` in `crossfire.config.json`
- **Role default**: `proposer`/`challenger` default to `guarded`, `judge` defaults to `plan`

The resolution function (`resolveRolePreset()` in `@crossfire/cli/config/policy-resolution`) returns both the resolved preset and its source (`cli-role`, `cli-global`, `config`, or `role-default`) for observability.

This preset resolution feeds into the runtime turn-level precedence system described below.

## Evidence Policy

Evidence policy controls the strength of citation requirements in role contracts. Evidence thresholds are resolved through an independent chain from preset resolution:

```text
CLI --evidence-bar > config inline > template override > role-contract default
```

- **CLI --evidence-bar**: `crossfire start --evidence-bar high` applies to all roles
- **Config inline**: `roles.proposer.evidence.bar` in `crossfire.config.json`
- **Template override**: `templates[].overrides.evidence.bar` for roles using that template
- **Role-contract default**: each role's contract has a built-in default (`medium` for proposer, `high` for challenger and judge)

Valid evidence bar values: `low`, `medium`, `high`

The resolution function (`resolveRoleEvidence()` in `@crossfire/cli/config/evidence-resolution`) returns the evidence provenance source (`cli`, `config`, `template:name`, or `role-default`). The compiler then merges that chain with the role-contract defaults to produce the effective `ResolvedPolicy.evidence.bar`.

Evidence policy is passed to `compilePolicyWithDiagnostics()` via the `evidenceOverride` parameter and merged into the role contract during compilation. The effective evidence bar is surfaced in inspect/status output, while the baseline evidence source is stored on the adapter entry for event provenance. The runner also appends evidence-policy guidance to live prompts and recovery context so evidence settings affect runtime behavior rather than observation only.

## Custom Templates

The config file supports optional custom templates that bundle a base preset with evidence and interaction policy overrides. Templates are defined in the `templates` array and can be referenced by roles via the `template` field.

### Template Structure

Each template in `crossfire.json` has:

- `name` (string, required): Unique identifier for the template
- `basePreset` (enum, optional): One of `research`, `guarded`, `dangerous`, `plan`. If omitted, the role's default preset is used.
- `overrides` (object, optional): Policy overrides applied after base preset compilation
  - `evidence` (object, optional): Evidence policy overrides
    - `bar` (enum): One of `low`, `medium`, `high`
  - `interaction` (object, optional): Interaction policy overrides
    - `approval` (enum, optional): One of `always`, `on-risk`, `on-failure`, `never`
    - `limits` (object, optional): Turn limits
      - `maxTurns` (number, optional): Maximum number of turns

### Template Usage

Templates are referenced by name in role configs:

```json
{
  "templates": [
    {
      "name": "strict-evidence",
      "basePreset": "guarded",
      "overrides": {
        "evidence": { "bar": "high" },
        "interaction": { "approval": "always" }
      }
    }
  ],
  "roles": {
    "proposer": {
      "binding": "claude-default",
      "template": "strict-evidence"
    },
    "challenger": {
      "binding": "claude-default",
      "preset": "research"
    }
  }
}
```

Roles can also override evidence directly without using templates:

```json
{
  "roles": {
    "proposer": {
      "binding": "claude-default",
      "preset": "guarded",
      "evidence": { "bar": "high" }
    }
  }
}
```

### Validation Rules

- Template names must be unique within the `templates` array
- `basePreset` must be a valid preset name if specified
- Evidence `bar` must be one of `low`, `medium`, `high`
- Interaction `approval` must be one of `always`, `on-risk`, `on-failure`, `never`
- The config schema is strict: legacy fields such as `allowed_tools` / `mcp_servers` and unapproved template override keys are rejected rather than silently ignored

Templates are resolved during config loading and their resolved policies are stored in the adapter wiring layer for runtime use.

## Turn-Level Precedence

Effective turn policy is resolved with this priority:

```text
role baseline < turn override
```

- Role baseline is compiled via `compilePolicyWithDiagnostics({ preset, role })` during adapter wiring and stored as `baselinePolicy` plus baseline clamp/provenance/observation metadata on each adapter entry
- Per-turn overrides are specified via `DebateConfig.turnPresets` (a `Record<string, PolicyPreset>` mapping turnId to preset name)

When a turn override is active, the runner compiles a fresh policy with the override preset. The baseline policy is never mutated.

The runner emits `policy.baseline` once per role after `debate.started`, then emits `policy.turn.override` before a proposer / challenger turn when a turn-level override is active and `policy.turn.override.clear` after the turn completes. Override events carry the full effective override policy plus real translation summary and warnings from the same observation rule path used by inspection.

Judge turns always receive the judge adapter entry's baseline policy. That baseline defaults to `plan`, but it is compiled from the resolved judge preset and may be overridden through the normal judge preset resolution path.

## Provider Translation

Each adapter has a `translatePolicy(policy: ResolvedPolicy): ProviderTranslationResult<NativeOptions>` pure function. Translation warnings are emitted as `run.warning` events so users can see where policy intent was approximated.

### Claude

`translatePolicy()` maps `ResolvedPolicy` to Claude SDK query options:

- `interaction.approval` -> `permissionMode`: `always`/`on-risk` -> `default`, `on-failure` -> approximate to `default`, `never` -> `bypassPermissions`
- Plan-shaped policies (approval=always + read-only capabilities + off shell/subagents + off/search network) -> `permissionMode: "plan"`
- `capabilities.shell === "exec"` -> `allowDangerouslySkipPermissions: true`
- `interaction.limits.maxTurns` -> `maxTurns`
- Capability enums drive tool deny lists: `filesystem: "off"` denies all file tools, `filesystem: "read"` denies write tools, `shell: "off"` denies Bash, etc.

Recovery path: the Claude adapter reapplies the same translated policy options when falling back to transcript recovery, so permission mode, tool restrictions, and turn limits survive partial failures.

### Codex

`translatePolicy()` maps `ResolvedPolicy` to Codex JSON-RPC session parameters:

- `interaction.approval` -> `approvalPolicy`: `always`/`on-risk` -> `on-request`, `on-failure` -> `on-failure`, `never` -> `never`
- `capabilities` -> `sandboxPolicy`: filesystem/shell/network levels determine `readOnly`, `workspace-write`, or `danger-full-access`
- `capabilities.network === "off"` -> `networkDisabled: true`

The `sandboxPolicy` object from `translatePolicy()` is forwarded verbatim to `thread/start` and `turn/start`. Codex-native approval options (`availableDecisions`) are preserved as `nativeOptions` in approval events, not flattened to plain allow/deny.

Warnings: Codex does not support per-tool allow/deny lists, per-session turn limits, maxToolCalls, timeoutMs, or budgetUsd.

### Gemini

`translatePolicy()` maps `ResolvedPolicy` to Gemini CLI approval-mode arguments:

- `interaction.approval` -> `approvalMode`: `never` -> `yolo`, `on-failure` -> `plan`, `on-risk`/`always` -> `default`
- `capabilities.shell === "exec"` + `network === "full"` -> `yolo` override

Limitations: Gemini headless does not provide approval round-trips comparable to Claude or Codex; mode support is best-effort startup mapping. Tool-selection control remains provider-native / MCP-driven.

## CLI Entry Points

`crossfire start` accepts preset-first flags:

- `--preset <research|guarded|dangerous|plan>` sets the debate default
- `--proposer-preset <research|guarded|dangerous|plan>` per-role preset
- `--challenger-preset <research|guarded|dangerous|plan>` per-role preset
- `--judge-preset <research|guarded|dangerous|plan>` per-role preset
- repeatable `--turn-preset <turnId=preset>` applies a static per-turn override
- `--config <path>` loads a `crossfire.json` config file (required)

Examples:

```bash
crossfire start \
  --config crossfire.json \
  --topic "Should we migrate to Rust?" \
  --proposer-preset research \
  --challenger-preset guarded
```

```bash
crossfire start \
  --config crossfire.json \
  --topic "Should we adopt feature flags?" \
  --proposer-preset research \
  --turn-preset p-1=plan
```

## Event and UI Implications

Relevant surfaces:

- adapter-core: `StartSessionInput.policy`, `TurnInput.policy` carry the compiled `ResolvedPolicy`
- adapter-core: `ResolvedPolicy`, `compilePolicy()`, `translatePolicy()` per adapter
- orchestrator-core: `DebateConfig.turnPresets` for per-turn preset overrides
- orchestrator: `policy.baseline`, `policy.turn.override`, `policy.turn.override.clear` events
- TUI: live panels show the current effective preset in the header; full policy provenance is available via `/status policy`
- Translation warnings are emitted as `run.warning` events when policy intent is approximated during provider translation

This keeps the event log explicit about policy decisions instead of forcing operators to infer them from provider-side behavior.

## Policy Regression Harness

Phase B established a three-layer regression harness for the policy compilation pipeline:

1. **Policy core** (`adapter-core`): Golden matrix of 7 preset x role combinations with full field assertions. Verifies `ResolvedPolicy` structure and capability clamping. No provider-native assertions allowed in this layer.

2. **Adapter translation** (`adapter-{claude,codex,gemini}`): Per-adapter golden cases covering exact mappings, approximate mappings, and intentional deltas. All tests use structured `expectWarning()` assertions on `field` + `adapter` + `reason`, not message text.

3. **Wiring regression** (`cli`, `orchestrator`): Baseline policy flow and turn override flow tested separately. Includes data-flow smoke that verifies the compile -> translate -> adapter chain without LLM mocking.

Shared test fixtures and warning helpers live in `@crossfire/adapter-core/testing` (internal test-support surface, not a public API).

Intentional behavior deltas (e.g., Claude `research` mapping to `default` instead of `dontAsk`) are grouped in `describe("intentional deltas")` blocks with `INTENTIONAL DELTA:` prefixed test names that assert both new and old behavior.

## Packaging Abstraction: Why Provider-Specific

Crossfire policy controls tool access through capability enums (`filesystem`, `network`, `shell`, `subagents`) rather than per-tool allow/deny lists. This is an intentional design decision:

- **Semantic honesty:** Providers handle tools differently. Claude has named builtin tools with stable identity. Codex has a capability-driven sandbox model with no stable tool inventory. Gemini offers coarse approval-mode control only. A normalized tool catalog would misrepresent provider reality.
- **User value:** Policy presets (`research`, `guarded`, `dangerous`, `plan`) already provide sufficient risk control. Per-tool granularity creates provider lock-in (Claude's `Read`/`Edit` vs Codex's sandbox modes).
- **Execution relevance:** Provider-native translation (Claude tool deny lists, Codex sandbox levels, Gemini approval modes) is simpler and more maintainable than ongoing abstraction layers.

The `ToolSource` enum (`builtin | mcp | provider-packaged | unknown`) in `adapter-core/src/policy/observation-types.ts` is observation metadata only, not a normalized product object. It exists for display and debugging purposes in inspection views like `/status policy`, not as a cross-provider control surface.

Future cross-provider tool normalization would require a new plan with evidence of user demand and stable tool catalog semantics across all three providers.

**Decision record:** See `docs/superpowers/decisions/2026-04-04-packaging-abstraction.md` for full evaluation criteria and rationale.
