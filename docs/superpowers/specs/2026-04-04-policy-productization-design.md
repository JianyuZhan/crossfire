# Phase D — Policy Productization Design

## Status

Draft

## Summary

Phase D turns the policy system into a first-class product surface.

Phases A through C established the following foundation:

- Phase A: policy-first execution core (`PresetInput -> ResolvedPolicy -> ProviderTranslationResult`)
- Phase B: regression harness and confidence layer
- Phase C: policy-facing configuration and inspection surface (`inspect-policy`, `inspect-tools`, preset-first CLI, event-derived runtime state)

Phase D builds on that foundation to make policy usable as an everyday runtime and product concept.

By the end of Phase D:

- users can inspect runtime policy state directly through TUI live commands
- evidence policy becomes a first-class configurable policy concept
- presets become UX shorthand rather than the semantic core
- users can define reusable policy templates
- TUI surfaces explain effective policy, warnings, and clamp behavior
- remaining legacy scaffolding is removed
- Crossfire has an explicit product decision on provider-native packaging abstraction

Phase D is organized as one umbrella spec with three implementation plans:

1. **D1 — Runtime Visibility**: `/status policy`, `/status tools`, TUI policy state tracking
2. **D2 — Policy Extensions**: evidence policy independence, custom templates, capability taxonomy (evidence only)
3. **D3 — Cleanup & Packaging Decision**: legacy removal, packaging abstraction decision

Recommended execution order: D1 → D2 → D3.

## Motivation

After Phase C, the policy system is visible and configurable, but it is still primarily a structured engineering surface. Several product gaps remain:

- Runtime policy visibility is not yet interactive. Users cannot query effective policy during a running debate.
- Evidence policy exists as a read-only semantic field (`RoleSemantics.evidenceBar`) but is not user-configurable.
- Presets are still the only top-level shorthand. Users cannot define reusable policy configurations.
- TUI visibility is limited. Policy events are largely no-ops in the display layer.
- Some transitional policy scaffolding remains (23 `executionMode` references in TUI, judge.ts fallback, orphaned dist artifacts, transitional wrappers).
- Provider-native packaging (skills / plugins / extensions) is not yet resolved as a product-level concept.

Phase D exists to complete the shift from internal architecture to coherent product behavior.

## Goals

### D1 — Runtime Visibility

- Add `/status policy` and `/status tools` as TUI live commands for active debate sessions
- Add optional low-cost supporting summary rendering in existing TUI surfaces where non-disruptive (such as warning count badges on agent panel headers)
- Track `RuntimePolicyState` per active session, per role, in TUI store
- Replace `executionMode` string display with effective preset from `RuntimePolicyState`
- Factor status renderers into a view model layer independent of TUI store internals, so the same rendering logic can later support replay, side panels, or web UI

### D2 — Policy Extensions

- Introduce a first-class top-level `evidence` policy section in `ResolvedPolicy` with a minimal Phase D surface: `evidence.bar`
- Make evidence bar configurable through config, templates, and CLI, with independent provenance tracking
- Add custom templates: flat named policy shortcuts (`basePreset + overrides`), no inheritance, no composition, no provider-native payloads
- No new `capabilities.*` enum values. The only taxonomy change is evidence independence.

### D3 — Cleanup & Packaging Decision

- Remove remaining execution-mode-first mental model remnants from production source, architecture docs, and README examples
- Remove deprecated scaffolding: TUI `executionMode` fields, judge.ts fallback, orphaned dist artifacts, transitional wrappers
- Evaluate `legacyToolOverrides` for removal or explicit retention
- Make an explicit, documented packaging abstraction decision based on 4 criteria
- Ensure policy, templates, and evidence are the only primary product concepts

## Non-Goals

Phase D does not aim to:

- Redesign the core policy compiler
- Reintroduce provider-first execution modes
- Hide approximation or unsupported behavior behind friendly UI
- Guarantee a fully normalized packaging model if the adapters cannot support it honestly
- Add product features that bypass the policy pipeline
- Introduce new `capabilities.*` enum values (evidence is modeled outside `capabilities`)
- Build event-log replay or offline `/status` CLI subcommands
- Build always-visible TUI policy panels
- Support template inheritance, composition, or provider-native payloads
- Introduce a parallel semantic system for evidence, templates, or packaging outside the policy pipeline

---

## Design Principles

### 1. Policy remains the semantic source of truth

Presets, templates, status views, and TUI panels are all product surfaces over policy. They must not become competing semantic systems.

### 2. Runtime visibility must be event-derived

Authoritative runtime visibility comes from event-derived state. Adapter-local snapshots may exist only as execution caches, never as the source of truth. `/status` commands consume `RuntimePolicyState` reconstructed from emitted `policy.baseline`, `policy.turn.override`, and `policy.turn.override.clear` events.

### 3. Evidence belongs inside the policy pipeline

`evidence` is a top-level policy section in `ResolvedPolicy`. Phase D only exposes `evidence.bar`. Evidence follows the same resolution → compilation → translation → observation → inspection → status path as other policy dimensions. It must not become a separate product subsystem with its own resolution rules.

### 4. Templates are named policy shortcuts, not a composition system

Templates are flat, named, non-inheriting policy configurations that compile into normal policy inputs. They must not reference other templates, carry provider-native options, or bypass preset + role-ceiling semantics. Templates must preserve explainable provenance in inspect and status output.

### 5. No new capability enum values without cross-adapter honest translation

Phase D's taxonomy change is limited to evidence independence. New `capabilities.*` enum values (such as `network: "localhost-only"` or `shell: "script"`) are deferred unless a provider-agnostic, honestly translatable use case emerges.

### 6. Productization must not fake precision

TUI, runtime status, and packaging abstractions must remain conservative where provider fidelity is partial. Prefer `unknown` over false precision. Evidence translation may influence prompting and observation summaries, but must not be presented as a provider-native enforcement mechanism unless the adapter can support that honestly.

---

## Runtime Status Commands

### `/status policy`

#### Purpose

Show the current effective runtime policy state for each active role.

#### Inputs

TUI live command. No arguments required. Available only during an active debate session.

#### Output per role

- Role, adapter, model
- Baseline preset and source provenance
- Baseline resolved policy (capabilities, interaction, evidence)
- Baseline clamp notes
- Baseline translation summary
- Active warnings
- Active turn override (if any): turnId, override preset, override policy, override translation summary, override warnings

#### Behavior

- Data source: event-derived `RuntimePolicyState` for the current session
- Renders a snapshot of current state at invocation time (not auto-refreshing)
- Must clearly distinguish baseline vs active override
- When an active override exists, clearly labels it with turnId and override preset
- If no baseline event has been received yet (debate just started), displays "not yet available"

### `/status tools`

#### Purpose

Show the current effective runtime tool surface for each active role.

#### Output per role

- Current tool view (name, source, status, reason)
- Capability effects
- Completeness level
- Active warnings
- Whether the view reflects baseline or an active override

#### Behavior

- When an active override exists, `/status tools` reflects the override-derived tool view; otherwise it reflects baseline
- Explicitly labeled as best-effort observation, not an execution guarantee
- Shares rendering logic with `inspect-tools` (same view model), differing only in data source (runtime state vs pre-execution inspection)
- Data comes from the observation payload stored in `RuntimePolicyState`, not by re-running adapter observation at query time (see Observation in runtime events below)

### View model requirements

Status renderers must be factored independently from TUI command handler and TUI store internals. The same view model should be reusable by:

- `/status` TUI live commands (Phase D)
- Future replay from event logs
- Future side panels or web UI

### Observation in runtime events

`/status tools` must render from event-derived state, not by re-running adapter observation logic inside the TUI process. This requires that the observation payload be captured at emission time and stored in `RuntimePolicyState`.

#### Event enrichment

Phase D enriches `PolicyBaselineEvent` and `PolicyTurnOverrideEvent` to include the observation result:

```ts
interface PolicyBaselineEvent {
  // ... existing fields (policy, clamps, preset, translationSummary, warnings) ...
  observation: ProviderObservationResult; // NEW: tool view, capability effects, completeness
}

interface PolicyTurnOverrideEvent {
  // ... existing fields (policy, preset, translationSummary, warnings) ...
  observation: ProviderObservationResult; // NEW
}
```

The `observation` field is computed by the orchestrator at event emission time using the same adapter observation function that `inspect-tools` uses. This ensures `/status tools` reflects the same observation that would have been produced by pre-execution inspection for that policy.

#### RuntimePolicyState enrichment

```ts
interface RuntimePolicyState {
  baseline: {
    // ... existing fields ...
    observation: ProviderObservationResult; // NEW
  };
  currentTurnOverride?: {
    // ... existing fields ...
    observation: ProviderObservationResult; // NEW
  };
}
```

This keeps `/status tools` purely event-derived: the TUI store projects events into `RuntimePolicyState`, and the status view model reads from that projection without requiring access to adapter internals.

---

## Evidence Policy

### Structural change

`evidenceBar` is removed from `RoleSemantics` and promoted to a top-level section in `ResolvedPolicy`:

```ts
type EvidencePolicy = {
  readonly bar: EvidenceBar; // "low" | "medium" | "high"
};

type ResolvedPolicy = {
  readonly preset: PolicyPreset;
  readonly roleContract: RoleContract;
  readonly capabilities: CapabilityPolicy;
  readonly interaction: InteractionPolicy;
  readonly evidence: EvidencePolicy;
};
```

Phase D only exposes `evidence.bar`. The `EvidencePolicy` type leaves room for future fields (citation style, source requirements, etc.) without structural migration.

### RoleSemantics change

`evidenceBar` is removed from `RoleSemantics`. It retains `exploration`, `factCheck`, and `mayIntroduceNewProposal`.

### Defaults and resolution

- Role contracts provide a **default evidence bar** for each role (proposer=medium, challenger=high, judge=high)
- The role contract provides the default evidence input to compilation and resolution. It is not the runtime home of effective evidence state.
- Users may override the default through config, templates, or CLI
- The compiler merges defaults with user input and outputs the `evidence` section
- Phase D does not introduce evidence ceiling or floor. Role contract defaults can be fully overridden.

### Precedence

Evidence resolution is separate from preset resolution. Presets do not carry evidence defaults; they control capabilities and interaction only. Evidence defaults come exclusively from role contracts.

Evidence bar precedence (highest to lowest):

1. CLI direct override (`--evidence-bar`)
2. Role inline config field (`roles.proposer.evidence.bar`)
3. Role template override (`templates[].overrides.evidence.bar`)
4. Role contract default (proposer=medium, challenger=high, judge=high)

Presets are not in this chain. A role's `preset` field determines capabilities and interaction defaults; the role contract determines the evidence default. These are independent resolution paths that merge at compilation time.

### Provenance

Evidence has its own provenance field, separate from preset provenance:

```ts
evidence.source: "cli" | "config" | "template:<name>" | "role-default"
```

This allows cases where preset and evidence have different provenance origins.

### Product surface participation

Evidence policy participates in all policy product surfaces:

- `inspect-policy` shows effective evidence bar and source
- `/status policy` shows runtime evidence state
- Templates can set evidence overrides
- Adapter translation produces warnings if it cannot precisely implement evidence requirements

### Adapter behavior

- Evidence bar primarily routes to prompt and system message layers (semantic guidance), not to provider-native capability controls
- Evidence translation may influence prompting and observation summaries, but must not be presented as a provider-native enforcement mechanism unless the adapter can honestly support that
- If an adapter cannot distinguish evidence levels, it emits an `approximate` warning
- Adapters do not pretend evidence bar provides precise control over provider behavior

---

## Custom Templates

### Schema

```ts
type PolicyTemplateConfig = {
  readonly name: string;
  readonly basePreset?: PolicyPreset;
  readonly overrides?: {
    readonly evidence?: { readonly bar?: EvidenceBar };
    readonly interaction?: {
      readonly approval?: ApprovalLevel;
      readonly limits?: { readonly maxTurns?: number };
    };
  };
};
```

Only explicitly approved interaction subfields are template-overridable in Phase D: `approval` and `limits.maxTurns`.

Templates are defined in `CrossfireConfig.templates`:

```ts
type CrossfireConfig = {
  mcpServers?: Record<string, McpServerConfig>;
  providerBindings: ProviderBindingConfig[];
  templates?: PolicyTemplateConfig[];
  roles: RoleConfigMap;
};
```

### Constraints

- Templates must not extend, import, or compose other templates
- Templates must not carry provider-native options
- Template names must be unique within a config (Zod validation error on duplicates)
- Templates do not override `capabilities` in Phase D, to avoid creating a second policy authoring system that bypasses preset + role-ceiling semantics

### Role config usage

Roles reference templates by name:

```ts
type RoleConfig = {
  binding: string;
  preset?: PolicyPreset;
  template?: string;  // references templates[].name
  evidence?: { bar?: EvidenceBar };
  // ...
};
```

### Resolution precedence

The overall policy resolution merges two independent chains:

**Preset/capabilities/interaction chain** (determines capabilities and interaction):
```
CLI preset override > role template basePreset > role preset field > role default preset
```

**Evidence chain** (determines evidence bar):
```
CLI evidence override > role inline evidence > role template evidence override > role contract default
```

These chains are independent. A template that only overrides `evidence.bar` still needs a base preset for capabilities and interaction. That base comes from the template's `basePreset` field; if absent, from the role's `preset` field; if absent, from the role default preset.

Concretely: when a template is present, its `basePreset` (if set) takes priority over the role's `preset` field for capabilities/interaction. If the template omits `basePreset`, the role's `preset` field (or the role default) provides the base. Templates and role preset are never merged as dual bases.

### Provenance

Template expansion produces provenance tagged as `template:<name>`. Inspect and status output must show:

- The final effective value and its source (default / config / template / CLI)
- When the source is a template: the template name and its base preset

---

## TUI Integration

### D1 scope

1. **`/status policy` and `/status tools` command registration** in live command handler, rendered to TUI command output area
2. **RuntimePolicyState tracking** in TUI store: new per-active-session, per-role `RuntimePolicyState` fields built from `policy.baseline`, `policy.turn.override`, and `policy.turn.override.clear` events
3. **Replace `executionMode` display**: agent panel header shows effective preset from RuntimePolicyState instead of the legacy `executionMode` string. Header shows effective preset only; full provenance is reserved for `/status policy`.
4. **Low-cost supporting summary**: optional warning count badge (such as a warning indicator) on panel headers where non-disruptive. No new panels.

### Not in D1 scope

- Always-visible policy side panel
- Auto-refreshing status display (user invokes `/status` for point-in-time snapshot)
- Evidence or template TUI display (D2 work, but reuses D1 view model)

### Data flow

```
OrchestratorEvent → TuiStore.applyEvent() → RuntimePolicyState (per session, per role)
                                                    ↓
/status policy command → StatusPolicyViewModel → text renderer
/status tools command  → StatusToolsViewModel  → text renderer
```

---

## Legacy Removal

### Must-remove in D3

| Category | Location | Content |
|----------|----------|---------|
| TUI executionMode | `tui/src/state/types.ts`, `tui-store.ts`, `render-blocks.ts`, `agent-panel.tsx`, `line-buffer.ts`, `tool-status.ts` | `executionMode?: string` field and all reads/writes (~23 references) |
| Judge fallback | `orchestrator/src/judge.ts:209-210` | `executionMode: "plan"` fallback when no policy provided |
| Source-of-truth cleanup | `orchestrator-core/dist/execution-modes.*`, `cli/dist/commands/execution-mode-options.*` | Generated artifacts with no maintained source path |
| Transitional wrapper | `orchestrator-core/src/synthesis-prompt.ts:608-622` | `buildFullTextSynthesisPrompt()` transitional function |
| Legacy-fallback quality | `orchestrator-core/src/draft-report.ts:33`, `report-renderer.ts:8`, `runner.ts:947` | `"legacy-fallback"` generation quality type |

### Evaluate in D3

| Category | Location | Decision criteria |
|----------|----------|-------------------|
| `legacyToolOverrides` full chain | Compiler, all 3 adapters, runner (~45 references) | Remove if Phase D templates fully replace usage scenarios AND removal would not make inspection/status less honest than execution. Otherwise retain and mark as intentional legacy bridge. |
| Profile directory | `cli/src/profile/prompt-template.ts`, `topic-template-classifier.ts` | Active, not legacy. Confirm no dependency on old profile schema. |

### Goal

Legacy removal is not housekeeping. The goal is to ensure no documented or code-level execution-mode-first product surface remains. Policy, templates, and evidence must be the only primary product concepts.

---

## Packaging Abstraction Decision

### Default position

Phase D defaults to keeping provider-native packaging provider-specific. A normalized packaging abstraction will only be introduced if D1 and D2 demonstrate that it can be mapped honestly across adapters, improves user control materially, and does not hide important provider-specific limitations.

### No stealth normalization

Adapters may enrich observation metadata, but must not gradually invent a de facto normalized packaging abstraction without an explicit D3 decision. Any cross-provider packaging semantics must be a deliberate, documented choice.

### Decision criteria

A normalized packaging abstraction is only justified if all four conditions are met simultaneously:

1. **Semantic honesty**: the unified object does not lose fidelity across Claude, Codex, and Gemini
2. **User value**: it materially improves user control or understanding, not just internal tidiness
3. **Execution relevance**: it influences policy, config, or runtime surfaces, not just observation labels
4. **Testability**: it can be tested with stable assertions, not maintained through ambiguous interpretation

### Decision outputs

- **If keeping provider-specific**: document the rationale and confirm that observation metadata (source tags: `builtin | mcp | provider-packaged | unknown`) is sufficient as the only cross-provider surface
- **If introducing normalized abstraction**: requires full type design, adapter mapping, test coverage, and a separate implementation plan

The D3 packaging task produces a **documented decision**, which may or may not result in code changes.

---

## Architecture

### Surface layering

Phase D product surfaces must observe strict layering. No upper layer may redefine the semantics of a lower layer.

```
1. Policy model           — types, enums, ResolvedPolicy shape (including evidence)
2. Policy resolution      — defaults, precedence, template expansion
3. Policy compilation     — resolved input → compile → clamp → evidence merge
4. Adapter translation    — policy → provider-native options
5. Adapter observation    — policy → tool view, capability effects, warnings
6. Runtime event state    — event-derived RuntimePolicyState, per-session per-role
7. Product surfaces:
   - inspect-policy / inspect-tools  (pre-execution, from Layer 3 + 5)
   - /status policy / /status tools  (runtime, from Layer 6)
   - TUI rendering                   (consumes Layer 6)
```

Templates are a user-facing configuration construct resolved in Layer 2. They are not a product surface in Layer 7.

### Key invariants

- Layer 7 surfaces cannot invent semantics that do not exist in Layers 1-6
- Templates expand in Layer 2 and become equivalent to inline config
- Evidence is defined in Layer 1, compiled in Layer 3, translated/observed in Layers 4-5, and surfaced in Layers 6-7
- The difference between `inspect-*` and `/status *` is only the data source (Layer 3+5 vs Layer 6), not the semantics

### RuntimePolicyState lifecycle

```
debate start  → policy.baseline events (one per active role)  → RuntimePolicyState.baseline populated
turn start    → policy.turn.override (if turn preset differs) → currentTurnOverride set
turn end      → policy.turn.override.clear                    → currentTurnOverride cleared
```

Baseline events are emitted once per active role at session start. They are not re-emitted per round.

State is rebuilt by a projection function from the event stream. TUI store and `/status` commands consume the same projection. Both `/status policy` (which reads policy, clamps, warnings) and `/status tools` (which reads the observation payload) are served from this single projected state.

---

## Testing Strategy

Phase D extends the Phase B and C harness. It does not introduce a separate test framework.

### D1 tests

| Area | Coverage |
|------|----------|
| `/status policy` rendering | Given RuntimePolicyState → verify text output includes baseline, override, warnings, clamps, evidence |
| `/status tools` rendering | Given RuntimePolicyState + observation → verify tool view, completeness, override annotation |
| TUI store policy tracking | Send baseline/override/clear event sequences → verify RuntimePolicyState correctly updated per role |
| Event reconstruction | Given emitted events only, runtime policy state (including observation) can be reconstructed without adapter-local state |
| Observation in events | Baseline and override events carry observation payload; `/status tools` renders from stored observation, not re-computed |
| View model isolation | View model does not directly import TUI store internals |
| Live command integration | `/status policy` and `/status tools` registered, parsed, and dispatched correctly |

### D2 tests

| Area | Coverage |
|------|----------|
| Evidence compilation | `compilePolicy` output includes `evidence.bar`; role defaults correct |
| Evidence override | Config, template, CLI override evidence bar; precedence correct |
| Evidence provenance | Inspect and status output includes evidence source |
| Evidence adapter warnings | Adapter produces `approximate` warning when it cannot distinguish evidence levels |
| Template loading | Zod validation, unique name check, no-inheritance enforcement |
| Template expansion | Template → resolved policy correctly merges basePreset + overrides |
| Template precedence | CLI > inline > template > preset > default |
| Template provenance | Inspect and status annotate `template:<name>` source |
| Template interaction override | Only approved subfields accepted; others rejected by validation |

### D3 tests

| Area | Coverage |
|------|----------|
| Legacy absence | Zero references to `executionMode` in production source and architecture/README examples |
| Source-of-truth cleanup | Orphaned dist files absent |
| legacyToolOverrides decision | If removed: adapter golden tests updated. If retained: marked intentional with test annotation. |
| Packaging decision | Decision document exists and addresses all 4 criteria |

---

## Exit Criteria

### D1 exits when

- `/status policy` is available as a TUI live command and accurately reflects event-derived baseline and override state
- `/status tools` is available as a TUI live command and accurately reflects runtime tool view
- TUI store tracks per-session, per-role `RuntimePolicyState`
- Agent panel header displays effective preset from RuntimePolicyState, not legacy `executionMode`
- Status view models are independent of TUI store internals

### D2 exits when

- `ResolvedPolicy` includes a top-level `evidence` section
- Evidence bar is configurable through config, templates, and CLI, with independent provenance
- Custom templates are definable in config: flat only, validated by Zod, with unique names
- Templates participate in inspect and status output with provenance
- Adapter evidence translation produces honest warnings where fidelity is partial
- No new `capabilities.*` enum values have been introduced

### D3 exits when

- No documented or code-level execution-mode-first product surface remains
- Judge.ts fallback removed
- Orphaned dist artifacts removed
- `legacyToolOverrides` evaluated and either removed or explicitly retained with documentation
- Packaging abstraction decision documented with 4-criteria evaluation
- If decision is "keep provider-specific": observation metadata confirmed sufficient
- Policy, templates, and evidence are the only primary product concepts

### Phase D overall

Phase D is complete when D1, D2, and D3 are all complete.

---

## Open Questions

These are intentionally deferred unless they block implementation:

1. Should evidence policy eventually support ceiling or floor semantics from role contracts, similar to capability clamping?
2. Which future `EvidencePolicy` fields (citation style, source requirements, fact-check depth) would provide user value without cross-adapter false precision?
3. Should template interaction overrides expand beyond `approval` and `limits.maxTurns` in a future phase?
4. Is a normalized packaging abstraction honest enough across adapters to be worth introducing? (Evaluated in D3.)

## Future Work

Possible work after Phase D:

- Event-log replay for offline `/status` queries
- Always-visible TUI policy panel
- Template inheritance or composition
- Richer multi-session policy dashboards
- Policy history and diff views
- Policy recommendation or auto-tuning flows
- Deeper MCP-native capability controls if the model justifies them
- Expanded evidence policy dimensions
