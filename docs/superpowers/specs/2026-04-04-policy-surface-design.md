# Phase C -- Policy Surface Design

## Status

Approved

## Summary

Phase C turns the policy-first architecture into the primary user-facing surface.

It merges the previous observability and configuration-surface work into a single
phase. The goal is not only to let users inspect effective policy, but also to make
policy the primary way Crossfire is configured.

By the end of Phase C:

- users can inspect effective policy and effective tools before execution
- profile configuration is policy-oriented rather than provider-parameter-oriented
- CLI inputs are preset/policy-first rather than execution-mode-first
- role defaults are explicit and visible
- baseline policy and turn override policy are recorded and inspectable

Phase C intentionally does not include runtime `/status` commands, TUI policy views,
evidence policy productization, or user-defined presets. Those remain in Phase D.

## Motivation

Phase A introduced the policy-first core:

`PresetInput -> ResolvedPolicy -> ProviderTranslationResult`

Phase B made that behavior safe to evolve by adding harnesses and regression coverage.

At this point, the internals are ready, but the main user surface is still
transitional unless we finish two related tasks together:

1. expose the effective policy system visibly
2. make the configuration surface speak that same policy language

These two concerns are merged because there is no legacy migration requirement and
no active external user base that forces a staged compatibility rollout.

Separating observability from configuration would preserve an unnecessary
transitional layer:
- users could inspect the new policy model
- but still configure the system through old mode/profile concepts

Phase C removes that split.

## Goals

Phase C must deliver the following:

### 1. Inspection surfaces

- add `inspect-policy` and `inspect-tools` commands
- support both text and JSON output
- show effective policy, clamp reasons, translation warnings, and effective tool
  visibility
- inspection reports known effective tool behavior and explicit uncertainty, not
  guaranteed full provider inventory

### 2. Configuration-surface redesign

- replace the old profile schema with a policy-oriented single-file schema
- logically separate role profile concerns from provider binding concerns
- remove execution-mode-first configuration from the main surface
- make role default preset rules explicit

### 3. Runtime-visible policy state

- record session baseline policy as structured events
- record applied turn override policy
- retain structured warnings and translation summaries for later runtime/status work

### 4. Single-source-of-truth behavior

- `start`, `inspect-policy`, and `inspect-tools` must reuse the same policy
  resolution path
- configuration, inspection, and execution must describe the same underlying policy
  artifacts

### 5. Compiler and resolution diagnostics

- `compilePolicyWithDiagnostics()` returns clamp notes alongside ResolvedPolicy
- preset source provenance tracked through the resolution layer
- clamp notes and preset source together support inspection's explanation capability

## Non-Goals

Phase C does not include:

- runtime `/status policy` or `/status tools`
- TUI policy views
- user-defined presets
- evidence policy configuration
- finer-grained capability taxonomy redesign
- `mcp` as a first-class new capability dimension
- unified skill/plugin/extension product modeling
- compatibility with the old profile schema

## Design Principles

### 1. Policy becomes the public surface

After Phase C, users should primarily think in terms of:

- preset
- role contract
- effective policy
- clamp
- warnings
- effective tools

They should not need to reason in terms of provider-native execution modes.

### 2. Inspection and execution must reuse the same path

Inspection is not a parallel model. It must use the same:

- input resolution
- default selection
- `compilePolicy()` / `compilePolicyWithDiagnostics()`
- adapter observation / translation logic

If execution chooses a policy, inspection must show that exact policy and its
derived results.

### 3. Profiles are not provider parameter bags

The new configuration surface must separate:

- role intent
- provider binding
- optional role-level preset or policy selection

It must not continue the old pattern where provider-native parameters leak through
the profile as loosely grouped fields.

### 4. Remove, do not preserve, the legacy schema

Phase C does not support old profile compatibility. The old schema may be deleted or
replaced directly. If a temporary migration utility is helpful during implementation,
it is an implementation aid, not a product compatibility promise.

### 5. Tool observability is conservative

Tool source tags must remain conservative:

- `builtin`
- `mcp`
- `provider-packaged`
- `unknown`

Crossfire must prefer `unknown` over false precision.

---

## Configuration Surface

Phase C replaces the old profile schema with a policy-oriented single-file
configuration model.

### New Schema

Single file, logically split into `providerBindings` + `roles`:

```ts
type CrossfireConfig = {
  mcpServers?: Record<string, McpServerConfig>;
  providerBindings: ProviderBindingConfig[];
  roles: {
    proposer: RoleProfileConfig;
    challenger: RoleProfileConfig;
    judge?: RoleProfileConfig;
  };
};

type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type ProviderBindingConfig = {
  name: string;
  adapter: "claude" | "codex" | "gemini";
  model?: string;
  providerOptions?: Record<string, unknown>;
  mcpServers?: string[];         // references mcpServers registry keys
};

type RoleProfileConfig = {
  binding: string;              // references providerBindings[].name
  model?: string;               // overrides binding-level model
  preset?: PolicyPreset;        // explicit preset; omit for default rule
  systemPrompt?: string;
};
```

Design rationale:

- `mcpServers` at the top level is a shared registry of MCP server definitions,
  referenced by name from provider bindings. This separates server definition
  (command, args, env) from binding attachment, allowing reuse across bindings.
  The loader must validate that all binding-level `mcpServers` references resolve
  to entries in this registry.
- `roles` uses fixed keys (not an array) because the role set is closed; arrays
  would require redundant role/duplication/ordering validation
- `binding` is a string reference, not inline, to keep role intent and provider
  concerns separated
- `model` can appear at binding or role level; role-level overrides binding-level
- `providerOptions` is an escape hatch for provider-native configuration that
  cannot be normalized yet; it must not carry policy semantics and must not
  substitute for `preset`, role defaults, or role config
- `mcpServers` at the binding level is attachment metadata in Phase C, not yet a
  first-class capability dimension

Example YAML:

```yaml
mcpServers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
  docs:
    command: npx
    args: ["-y", "docs-mcp-server"]

providerBindings:
  - name: claude-default
    adapter: claude
    model: claude-sonnet
    mcpServers:
      - github
      - docs

  - name: codex-default
    adapter: codex
    model: gpt-5-codex

roles:
  proposer:
    binding: claude-default
    preset: guarded
    systemPrompt: ...

  challenger:
    binding: codex-default
    preset: research

  judge:
    binding: claude-default
    preset: plan
```

### Shared Resolution Module

Location: `packages/cli/src/config/policy-resolution.ts`

```ts
export const DEFAULT_ROLE_PRESETS = {
  proposer: "guarded",
  challenger: "guarded",
  judge: "plan",
} as const;

export function resolveRolePreset(input: {
  role: "proposer" | "challenger" | "judge";
  configPreset?: PolicyPreset;
  cliRolePreset?: PolicyPreset;
  cliGlobalPreset?: PolicyPreset;
}): {
  preset: PolicyPreset;
  source: "cli-role" | "cli-global" | "config" | "role-default";
};
```

Precedence (highest to lowest):

1. CLI role-specific preset (`--proposer-preset`, etc.)
2. CLI global preset (`--preset`)
3. Config file role preset
4. Role default rule

`source` is preserved and displayed by `inspect-policy`.

### Resolver Output

The resolver produces a typed intermediate for downstream consumption:

```ts
type ResolvedRoleRuntimeConfig = {
  role: "proposer" | "challenger" | "judge";
  adapter: "claude" | "codex" | "gemini";
  bindingName: string;
  model?: string;
  preset: {
    value: PolicyPreset;
    source: "cli-role" | "cli-global" | "config" | "role-default";
  };
  systemPrompt?: string;
  providerOptions?: Record<string, unknown>;
  mcpServers?: string[];
};
```

This type is consumed by `compilePolicy()` / `compilePolicyWithDiagnostics()`,
`inspect-policy`, `inspect-tools`, and `start`.

### Loader / Resolver Rework

- `schema.ts` -- define `CrossfireConfig`, `RoleProfileConfig`,
  `ProviderBindingConfig`
- `loader.ts` -- load single config file, validate binding reference integrity
  and mcpServers registry reference integrity
- `resolver.ts` -- resolve config + CLI flags into `ResolvedRoleRuntimeConfig`
  per role

### Old Schema Handling

Delete old `ProfileConfig` type and related loader/resolver logic. No compatibility
preservation. Temporary internal migration helpers during implementation are
implementation aids, not product promises.

---

## Compiler Diagnostics

### compilePolicyWithDiagnostics()

Location: `packages/adapter-core/src/policy/compiler.ts`

```ts
type CapabilityLevelValue =
  | FilesystemLevel
  | NetworkLevel
  | ShellLevel
  | SubagentLevel;

type PolicyClampNote = {
  field:
    | "capabilities.filesystem"
    | "capabilities.network"
    | "capabilities.shell"
    | "capabilities.subagents";
  before: CapabilityLevelValue;
  after: CapabilityLevelValue;
  reason: "role_ceiling";
};

type CompilePolicyDiagnostics = {
  policy: ResolvedPolicy;
  clamps: PolicyClampNote[];
};

// Existing API unchanged
function compilePolicy(input: CompilePolicyInput): ResolvedPolicy;

// New diagnostics entry point
function compilePolicyWithDiagnostics(
  input: CompilePolicyInput,
): CompilePolicyDiagnostics;
```

### Internal Implementation

Both functions share `compilePolicyInternal()`:

- `compilePolicy()` returns `compilePolicyInternal(input).policy`
- `compilePolicyWithDiagnostics()` returns the full result

Clamp notes are generated during the role ceiling clamp step. Each capability
field that is lowered records a `{field, before, after, reason: "role_ceiling"}`.
Fields not clamped produce no record.

### Boundary: Compiler vs Resolution Diagnostics

Preset source tracking is a responsibility of the resolution layer, not the
compiler. `compilePolicyWithDiagnostics()` reports clamp effects only. Preset
provenance must not be added to compiler diagnostics.

### Consumers

- `inspect-policy` -- displays clamp before/after and reason
- `inspect-tools` -- clamp indirectly affects tool availability via adapter
  observation
- execution (`start`) -- continues using `compilePolicy()`, no diagnostics needed

### Future Extension

`PolicyClampNote.reason` currently only includes `"role_ceiling"`. Phase D may
introduce interaction ceiling or evidence ceiling; the reason enum extends without
structural change.

---

## Adapter Observation Surface

### Three-Layer Adapter Internal Structure

Each adapter is internally restructured into three layers:

**Layer 1 -- Shared Rule Helpers** (newly extracted)

Per-adapter rule helpers that produce intermediate resolution results:

```ts
// Example: Claude adapter
resolveApproval(policy): ApprovalResolution
resolveCapabilityEffects(policy): CapabilityEffectRecord[]
resolveToolView(policy): ToolInspectionRecord[]
classifyCompleteness(policy): "full" | "partial" | "minimal"
buildTranslationSummary(policy, ...): PolicyTranslationSummary
```

Warnings are assembled by the top-level functions from shared rule resolution
results. They must not become a second semantic source independent of the shared
rule helpers.

**Layer 2 -- translatePolicy()** (existing, refactored internals)

```ts
function translatePolicy(
  policy: ResolvedPolicy,
): ProviderTranslationResult<NativeOptions>;
```

Calls shared helpers, assembles native execution options and execution warnings.

**Layer 3 -- inspectPolicy()** (new)

```ts
function inspectPolicy(
  policy: ResolvedPolicy,
): ProviderObservationResult;
```

Calls the same shared helpers, assembles observation output.

**Critical constraint:** `translatePolicy()` and `inspectPolicy()` must not call
each other. They share rules, not representations. Neither function should
reverse-engineer the other's output.

### ProviderObservationResult Type

```ts
type ProviderObservationResult = {
  translation: PolicyTranslationSummary;
  toolView: ToolInspectionRecord[];
  capabilityEffects: CapabilityEffectRecord[];
  warnings: PolicyTranslationWarning[];
  completeness: "full" | "partial" | "minimal";
};

type PolicyTranslationSummary = {
  adapter: string;
  nativeSummary: Record<string, unknown>;
  exactFields: string[];
  approximateFields: string[];
  unsupportedFields: string[];
};

type CapabilityEffectRecord = {
  field: string;                  // e.g. "capabilities.filesystem"
  status: "applied" | "approximated" | "not_implemented";
  details?: string;
};

type ToolInspectionRecord = {
  name: string;
  source: "builtin" | "mcp" | "provider-packaged" | "unknown";
  status: "allowed" | "blocked" | "degraded" | "unknown";
  reason:
    | "capability_policy"
    | "role_ceiling"
    | "legacy_override"
    | "provider_limitation"
    | "adapter_default"
    | "unknown";
  capabilityField?: string;
  details?: string;
};
```

### Per-Adapter Strategy

| Adapter | toolView | capabilityEffects | completeness |
|---------|----------|-------------------|--------------|
| Claude  | Known built-in tools (Bash, Read, Edit, Write, Glob, Grep, LS, WebFetch, Task) + configured MCP tools if resolvable | Rich | `"partial"` |
| Codex   | Minimal or empty -- Codex has no stable discrete tool surface | Sandbox/network/approval effects | `"minimal"` |
| Gemini  | Minimal or empty -- approval mode is the primary control | Approval/capability effects | `"minimal"` |

**Hard constraint:** `inspect-tools` reports a best-effort effective tool view.
Adapters with a reliable known-tool registry may report partial or near-full tool
visibility; adapters without one must report capability effects and explicit
uncertainty rather than inventing a complete tool inventory.

### Consistency Tests

Each adapter must have tests verifying:

- `inspectPolicy(p).warnings` and `translatePolicy(p).warnings` are consistent
  under the same policy (observation may be a superset of execution warnings, but
  differences must be intentional and documented)
- `inspectPolicy(p).translation` and `translatePolicy(p).native` are semantically
  consistent on key fields (e.g., Claude `permissionMode`, Codex
  `approvalPolicy + sandboxPolicy`, Gemini `approvalMode`)
- `toolView` can under-approximate uncertain tool visibility but must not overstate
  allowed behavior beyond translated execution constraints

---

## User-Facing Commands

### inspect-policy

**Purpose:** Show the effective policy for each role before execution.

**Inputs:** Same config + CLI flags as `start`, plus:

- `--format text|json` (default: text)
- `--role proposer|challenger|judge` (optional, filters to single role)

**Execution path:** Shares the same resolution pipeline as `start`:

1. Load config -> `CrossfireConfig`
2. Parse CLI overrides
3. `resolveRolePreset()` -> `ResolvedRoleRuntimeConfig` (with preset source)
4. `compilePolicyWithDiagnostics()` -> `{ policy, clamps }`
5. `inspectPolicy(policy)` -> `ProviderObservationResult`
6. Render output

**JSON shape:**

```ts
type PolicyInspectionReport = {
  roles: RolePolicyInspection[];
};

type RolePolicyInspection = {
  role: "proposer" | "challenger" | "judge";
  adapter: string;
  model?: string;
  preset: {
    value: PolicyPreset;
    source: "cli-role" | "cli-global" | "config" | "role-default";
  };
  resolvedPolicy: ResolvedPolicy;
  clamps: PolicyClampNote[];
  translation: PolicyTranslationSummary;
  warnings: PolicyTranslationWarning[];
  error?: { message: string };
};
```

**Text output requirements:**

Text output must answer quickly:

- what policy is effective per role
- where the preset came from (explicit vs default)
- what was clamped (before -> after + reason)
- what is approximate or unsupported
- what the provider-specific translation roughly became

Text output must follow a "summary first, details second" ordering.

### inspect-tools

**Purpose:** Show the effective tool view for each role after policy translation.

**Inputs:** Same as inspect-policy.

**Execution path:** Same pipeline steps 1-5, rendering the toolView and
capabilityEffects from `ProviderObservationResult`.

**JSON shape:**

```ts
type ToolInspectionReport = {
  roles: RoleToolInspection[];
};

type RoleToolInspection = {
  role: "proposer" | "challenger" | "judge";
  adapter: string;
  preset: {
    value: PolicyPreset;
    source: "cli-role" | "cli-global" | "config" | "role-default";
  };
  tools: ToolInspectionRecord[];
  capabilityEffects: CapabilityEffectRecord[];
  completeness: "full" | "partial" | "minimal";
  warnings: PolicyTranslationWarning[];
  error?: { message: string };
};
```

**Semantics:** `inspect-tools` is a best-effort observability view over the
current translated configuration and known provider metadata. It is not a hard
runtime execution guarantee. If an adapter cannot fully enumerate tool state, the
report must stay best-effort and make uncertainty explicit.

**Text output:** Must follow "summary first, details second" -- show preset,
summary, warnings/clamps/effects before detailed tool records.

### Shared Pipeline

Inspection commands must share a single `buildInspectionContext()` pipeline helper
that executes steps 1-5. This is a formal requirement, not an optional extraction.

`start`, `inspect-policy`, and `inspect-tools` must reuse the same preset option
parser and config resolution path. No duplicate resolution logic is allowed.

### Inspection and Turn Overrides

Inspection commands are role-level pre-execution previews. They show baseline
policy for each role, not synthetic per-turn views.

`--turn-preset` is a runtime-only flag. Inspection commands must reject it with
a clear error message if provided. This keeps the "shared flag surface" contract
honest: inspection and execution share role-level and global preset flags, but
not turn-level flags.

### Per-Role Failure Isolation

Per-role inspection failures must be isolated and reported. If one adapter's
observation fails, unaffected roles must still render. A per-role error field
is available in the output:

```ts
error?: { message: string };
```

---

## CLI Surface

Phase C moves the CLI toward a preset/policy-first user surface.

### New Flags

| Flag | Scope | Description |
|------|-------|-------------|
| `--preset <preset>` | Global | Default preset for all unspecified roles |
| `--proposer-preset <preset>` | Role | Proposer preset override |
| `--challenger-preset <preset>` | Role | Challenger preset override |
| `--judge-preset <preset>` | Role | Judge preset override |
| `--turn-preset <turnId>=<preset>` | Turn | Per-turn override |

Preset values: `research | guarded | dangerous | plan`

All presets are allowed for all roles. Role boundaries are enforced by
`RoleContract` ceilings and clamp reporting, not by CLI-level restrictions.

### Precedence

Matches the resolution module (Section: Configuration Surface):

1. CLI role-specific preset
2. CLI global preset
3. Config file role preset
4. Role default rule

### Turn Override Rules

- `--turn-preset` applies to proposer and challenger only. Judge is excluded from
  CLI turn overrides unless the runtime model changes later.
- Turn preset overrides the resolved baseline preset for that turn only.
- It does not replace baseline legacy tool policy input.
- It does not mutate stored session baseline policy.
- Parser should reuse the existing turn-override syntax shape, replacing the
  value domain from `mode` to `preset`.

### Old Flags Removal

`--mode`, `--proposer-mode`, `--challenger-mode`, `--turn-mode` are removed from
the main path:

- Delete old flag parsing code
- Replace `execution-mode-options.ts` with new preset-options module
- No implicit aliases or compatibility layer retained

### Inspect Command CLI Entry

`inspect-policy` and `inspect-tools` as `crossfire` subcommands:

- `crossfire inspect-policy [--format text|json] [--role <role>]`
- `crossfire inspect-tools [--format text|json] [--role <role>]`

They accept the same config/preset flags as `crossfire start`, enabling users to
preview any configuration combination before execution.

### Start Command Update

`crossfire start` switches to preset-first parameters:

- Accepts new `--preset` / `--*-preset` flags
- Config file parsing uses new schema
- Internally routes through `resolveRolePreset()` -> `compilePolicy()` -> adapter

### Documentation Updates

Removing old flags requires synchronized updates:

- `README.md`
- `README.zh-CN.md`
- Relevant `docs/architecture/*` files

---

## Runtime State Recording

### Purpose

Record structured policy state at runtime for Phase D's `/status policy` and
`/status tools`. Phase C records state; it does not add interactive runtime
commands.

### Event-Derived State Model

Runtime policy state must follow the project's event-sourcing contract:
`all state = projectState(events[])`.

`AdapterMapEntry` may cache current snapshot for execution convenience, but
**authoritative runtime policy state must be event-derived**.

Phase C must emit structured events carrying sufficient data to reconstruct
`RuntimePolicyState` without re-compilation. Specifically:

- **baseline policy event** -- emitted at session start, carries the full
  `ResolvedPolicy`, `PolicyClampNote[]`, preset source, `PolicyTranslationSummary`,
  and `PolicyTranslationWarning[]`
- **turn override event** -- emitted when a turn override is applied, carries the
  full `ResolvedPolicy` for that turn, preset value, `PolicyTranslationSummary`,
  and warnings, plus the `turnId`
- **turn override clear event** -- emitted when a turn completes, clears the
  current turn override

Events must carry full `ResolvedPolicy` objects, not just summaries, so that
`RuntimePolicyState` can be faithfully reconstructed from the event stream.

### RuntimePolicyState Type

```ts
type RuntimePolicyState = {
  baseline: {
    policy: ResolvedPolicy;
    clamps: PolicyClampNote[];
    preset: {
      value: PolicyPreset;
      source: "cli-role" | "cli-global" | "config" | "role-default";
    };
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
  };
  currentTurnOverride?: {
    turnId: string;
    policy: ResolvedPolicy;
    preset: PolicyPreset;
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
  };
};
```

### Recording Behavior

- Session start: emit baseline policy event, cache in AdapterMapEntry
- Turn override: emit turn override event, update currentTurnOverride with turnId
- Turn completion: currentTurnOverride must clear or transition to historical event
  (not persist as dangling current state)
- Turn overrides never overwrite baseline -- both are stored independently

### Phase C Output

Phase C may output compact policy summaries through existing `run.warning` event
paths (e.g., a one-line baseline summary at session start). No new interactive
runtime commands.

### Phase D Interface

Phase D's `/status policy` reads `RuntimePolicyState` as derived state
reconstructed from events, not from mutable objects.

---

## Legacy Removal

Phase C intentionally skips compatibility preservation.

### Type-Level Removals

- `RoleExecutionMode` type (deprecated)
- `TurnExecutionMode` type (deprecated)
- `StartSessionInput.executionMode` field
- `TurnInput.executionMode` field
- `StartSessionInput.allowedTools` / `disallowedTools` fields

### Implementation-Level Removals

- `mapExecutionModeTo*` fallback functions in each adapter
- `execution-mode-options.ts` (entire file, replaced by preset-options)
- Old `ProfileConfig` type and related loader/resolver logic

### Event-Level Removals

- Remove or rename `turn.mode.changed` and any remaining mode-first event
  payloads, documentation, and tests
- Phase C cleans this up completely; no mode-first event naming should remain

### Documentation-Level Removals

- Mode-first usage in README.md and README.zh-CN.md
- Mode-first references in docs/architecture/

---

## Architecture Invariants

Phase C must maintain these invariants:

1. **Single resolution path** -- `start`, `inspect-policy`, and `inspect-tools`
   share the same config -> resolution -> compile -> observation pipeline

2. **Presets are provider-agnostic** -- the same preset produces identical
   `ResolvedPolicy` regardless of target adapter

3. **Compilation is pure** -- `compilePolicy()` has no side effects and reads no
   external state

4. **Adapter observation does not invent semantics** -- `inspectPolicy()` produces
   output only from shared rule helper resolutions

5. **Inspection can under-approximate, never overstate** -- inspection may be more
   conservative than execution, but must not overstate allowed behavior beyond
   translated execution constraints

---

## Testing Strategy

Phase C extends the Phase B harness rather than replacing it.

### Required Test Areas

| Area | Coverage |
|------|----------|
| Config resolution | New schema loading, binding reference validation, preset precedence (CLI > config > default) |
| Compiler diagnostics | Clamp note accuracy, empty array when no clamp, field path format, CapabilityLevelValue types |
| Adapter observation | Per-adapter `inspectPolicy()` output, toolView/capabilityEffects/completeness per adapter |
| Consistency | `inspectPolicy().warnings` superset-of `translatePolicy().warnings`, translation summary semantically aligned with native |
| Inspection commands | `inspect-policy` text/JSON output, `inspect-tools` text/JSON output, per-role failure isolation |
| CLI surface | New preset flags parsing, old flags removed, start/inspect share parser |
| Wiring | Baseline recording, turn override does not overwrite baseline, runtime state completeness |
| Event-derived state | Runtime policy state reconstructible from emitted events, baseline not overwritten by turn override events, inspection/runtime summary aligned after legacy removal |

### Required Assertions

Tests must verify:

- structured warning preservation
- clamp explanations accurate (before/after/reason from compiler)
- source fallback to `"unknown"` when adapter cannot classify
- config separation between role profile and provider binding
- no duplicate policy resolution logic
- inspection output matches execution path assumptions
- `toolView` never overstates beyond translated execution constraints
- runtime policy state reconstructible from event stream

---

## Implementation Order

Recommended implementation sequence:

1. **Config foundation** -- new schema, loader/resolver rewrite, shared role
   default rules, CLI/config precedence
2. **Compiler diagnostics** -- `compilePolicyWithDiagnostics()`, clamp notes,
   preset source tracking in resolution
3. **Adapter observation** -- shared rule helpers, `inspectPolicy()`,
   toolView + capabilityEffects + completeness
4. **Inspection commands** -- `inspect-policy`, `inspect-tools`, text/JSON output,
   `buildInspectionContext()` shared pipeline
5. **CLI surface switch** -- new preset flags, old mode flags removed, doc updates
6. **Runtime state recording** -- structured policy events, baseline + turn
   override recording, event-derived state model

---

## Open Questions

Resolved during design:

1. **Adapter observation reuse strategy** -- resolved: shared rule helpers (B),
   not mutual invocation. Consistency via tests.
2. **nativeSummary detail level** -- resolved: `PolicyTranslationSummary` with
   `exactFields` / `approximateFields` / `unsupportedFields` classification.
3. **Old CLI flag aliases** -- resolved: no aliases kept. Direct removal.

---

## Exit Criteria

Phase C is complete when all of the following are true:

1. Users can inspect effective policy per role before execution
2. Users can inspect effective tools per role before execution
3. Clamp behavior is visible and explained (before -> after + reason)
4. Provider approximation and unsupported fields are visible
5. Profile configuration is separated into role profile and provider binding
6. The main CLI surface is preset/policy-first
7. Role defaults are explicit and shared across execution and inspection
8. Runtime records baseline policy and turn override policy as event-derived state
9. Debugging no longer requires reading adapter code or wiring code to understand
   policy outcomes

## Future Work

Phase C sets up, but does not deliver:

- runtime `/status policy` and `/status tools`
- evidence policy as a first-class user-facing feature
- user-defined presets
- finer-grained capability taxonomy
- TUI policy views
- `mcp` as a first-class capability dimension
- unified skill/plugin/extension product modeling
