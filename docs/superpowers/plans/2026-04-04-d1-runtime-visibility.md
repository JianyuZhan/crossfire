# D1 — Runtime Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime policy state visible through `/status policy` and `/status tools` TUI live commands, and replace legacy `executionMode` display with effective preset from event-derived state.

**Architecture:** Enrich policy events with observation payload, track session-scoped per-role `RuntimePolicyState` in TUI store, expose it through decoupled view models and text renderers, and wire `/status` commands into the existing TUI command dispatch pipeline. Architecture and README docs are updated in the same commits that change contracts and user-facing behavior.

**Tech Stack:** TypeScript, Vitest, Ink (React), Commander.js, pnpm monorepo

---

### Task 1: Enrich Event Types and Emit Full Observation

**Files:**
- Modify: `packages/orchestrator-core/src/orchestrator-events.ts`
- Modify: `packages/orchestrator-core/__tests__/policy-events.test.ts`
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: `packages/orchestrator/__tests__/policy-runner.test.ts`
- Modify: `docs/architecture/orchestrator.md`

The current `PolicyBaselineEvent` and `PolicyTurnOverrideEvent` carry `translationSummary` and `warnings` but not `toolView`, `capabilityEffects`, or `completeness`. The spec requires `/status tools` to render from event-derived state, so the full `ProviderObservationResult` must be in the events and `RuntimePolicyState`. The runner already computes observation via `getObservationForPolicy()` (line ~125-141) but only extracts `translation` and `warnings` into events. This task adds the type, emits it, and updates the architecture doc in one atomic commit.

- [ ] **Step 1: Write failing test for observation in PolicyBaselineEvent**

In `packages/orchestrator-core/__tests__/policy-events.test.ts`, add a test that constructs a `PolicyBaselineEvent` with an `observation` field and reconstructs state from it:

```ts
import type {
  PolicyBaselineEvent,
  PolicyTurnOverrideEvent,
  RuntimePolicyState,
} from "../src/orchestrator-events.js";
import type { ProviderObservationResult } from "@crossfire/adapter-core";

const stubObservation: ProviderObservationResult = {
  translation: {
    adapter: "claude",
    nativeSummary: {},
    exactFields: [],
    approximateFields: [],
    unsupportedFields: [],
  },
  toolView: [
    {
      name: "Bash",
      source: "builtin",
      status: "allowed",
      reason: "adapter_default",
    },
  ],
  capabilityEffects: [],
  warnings: [],
  completeness: "partial",
};

it("RuntimePolicyState baseline includes observation", () => {
  const state: RuntimePolicyState = {
    baseline: {
      policy: makeResolvedPolicy(),
      clamps: [],
      preset: { value: "research", source: "cli-role" },
      translationSummary: stubObservation.translation,
      warnings: [],
      observation: stubObservation,
    },
  };
  expect(state.baseline.observation.toolView).toHaveLength(1);
  expect(state.baseline.observation.completeness).toBe("partial");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/orchestrator-core && pnpm vitest run __tests__/policy-events.test.ts`
Expected: FAIL — Property 'observation' does not exist on type.

- [ ] **Step 3: Add observation field to event types and RuntimePolicyState**

In `packages/orchestrator-core/src/orchestrator-events.ts`:

Add import:
```ts
import type {
  PolicyClampNote,
  PolicyPreset,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  PresetSource,
  ProviderObservationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";
```

Add `observation` field to `PolicyBaselineEvent`:
```ts
export interface PolicyBaselineEvent {
  kind: "policy.baseline";
  role: "proposer" | "challenger" | "judge";
  policy: ResolvedPolicy;
  clamps: PolicyClampNote[];
  preset: {
    value: PolicyPreset;
    source: PresetSource;
  };
  translationSummary: PolicyTranslationSummary;
  warnings: PolicyTranslationWarning[];
  observation: ProviderObservationResult;
  timestamp: number;
}
```

Add `observation` field to `PolicyTurnOverrideEvent`:
```ts
export interface PolicyTurnOverrideEvent {
  kind: "policy.turn.override";
  role: "proposer" | "challenger";
  turnId: string;
  policy: ResolvedPolicy;
  preset: PolicyPreset;
  translationSummary: PolicyTranslationSummary;
  warnings: PolicyTranslationWarning[];
  observation: ProviderObservationResult;
  timestamp: number;
}
```

Add `observation` field to both `baseline` and `currentTurnOverride` in `RuntimePolicyState`:
```ts
export interface RuntimePolicyState {
  baseline: {
    policy: ResolvedPolicy;
    clamps: PolicyClampNote[];
    preset: {
      value: PolicyPreset;
      source: PresetSource;
    };
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
    observation: ProviderObservationResult;
  };
  currentTurnOverride?: {
    turnId: string;
    policy: ResolvedPolicy;
    preset: PolicyPreset;
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
    observation: ProviderObservationResult;
  };
}
```

- [ ] **Step 4: Update existing policy-events tests to include observation**

Update the existing `reconstructState()` tests to include `observation` in their event fixtures. For each test that creates a `PolicyBaselineEvent` or `PolicyTurnOverrideEvent`, add the `stubObservation` field.

- [ ] **Step 5: Run orchestrator-core tests to verify they pass**

Run: `cd packages/orchestrator-core && pnpm vitest run __tests__/policy-events.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing test for observation in emitted baseline event**

In `packages/orchestrator/__tests__/policy-runner.test.ts`, add a test that verifies the `policy.baseline` event includes the `observation` field:

```ts
it("emits policy.baseline with full observation payload", () => {
  const baselineEvents = events.filter(
    (e) => e.kind === "policy.baseline",
  );
  expect(baselineEvents.length).toBeGreaterThan(0);
  for (const evt of baselineEvents) {
    const baseline = evt as PolicyBaselineEvent;
    expect(baseline.observation).toBeDefined();
    expect(baseline.observation.toolView).toBeDefined();
    expect(baseline.observation.capabilityEffects).toBeDefined();
    expect(baseline.observation.completeness).toBeDefined();
    expect(baseline.observation.translation).toBeDefined();
  }
});
```

- [ ] **Step 7: Write failing test for observation in emitted override event**

```ts
it("emits policy.turn.override with full observation payload", () => {
  const overrideEvents = events.filter(
    (e) => e.kind === "policy.turn.override",
  );
  // If no overrides in this test's debate config, skip gracefully
  for (const evt of overrideEvents) {
    const override = evt as PolicyTurnOverrideEvent;
    expect(override.observation).toBeDefined();
    expect(override.observation.toolView).toBeDefined();
    expect(override.observation.completeness).toBeDefined();
  }
});
```

- [ ] **Step 8: Update emitBaselinePolicyEvents to include observation**

In `packages/orchestrator/src/runner.ts`, in `emitBaselinePolicyEvents()` (around line 143-168), change the event construction to include the full observation:

```ts
function emitBaselinePolicyEvents(
  bus: DebateEventBus,
  adapters: AdapterMap,
): void {
  for (const role of ["proposer", "challenger", "judge"] as const) {
    const entry = adapters[role];
    if (!entry?.baselinePolicy || !entry.baselinePreset) continue;
    const observation = getObservationForPolicy(entry, entry.baselinePolicy);
    const fallbackObservation: ProviderObservationResult = {
      translation: {
        adapter: entry.session.adapterId ?? "unknown",
        nativeSummary: {},
        exactFields: [],
        approximateFields: [],
        unsupportedFields: [],
      },
      toolView: [],
      capabilityEffects: [],
      warnings: [],
      completeness: "minimal",
    };
    const effectiveObservation = observation ?? fallbackObservation;
    bus.push({
      kind: "policy.baseline",
      role,
      policy: entry.baselinePolicy,
      clamps: [...(entry.baselineClamps ?? [])],
      preset: entry.baselinePreset,
      translationSummary: effectiveObservation.translation,
      warnings: [...effectiveObservation.warnings],
      observation: effectiveObservation,
      timestamp: Date.now(),
    });
  }
}
```

- [ ] **Step 9: Update turn override emission to include observation**

In the turn override emission block (around line 587-610), apply the same pattern:

```ts
if (hasTurnOverride) {
  const overridePolicy = compilePolicy({
    preset: turnOverridePreset,
    role: role as "proposer" | "challenger",
    legacyToolPolicy: adapterEntry.legacyToolPolicyInput,
  });
  const observation = getObservationForPolicy(adapterEntry, overridePolicy);
  const fallbackObservation: ProviderObservationResult = {
    translation: {
      adapter: adapterEntry.session.adapterId ?? "unknown",
      nativeSummary: {},
      exactFields: [],
      approximateFields: [],
      unsupportedFields: [],
    },
    toolView: [],
    capabilityEffects: [],
    warnings: [],
    completeness: "minimal",
  };
  const effectiveObservation = observation ?? fallbackObservation;
  bus.push({
    kind: "policy.turn.override",
    role: role as "proposer" | "challenger",
    turnId,
    policy: overridePolicy,
    preset: turnOverridePreset,
    translationSummary: effectiveObservation.translation,
    warnings: [...effectiveObservation.warnings],
    observation: effectiveObservation,
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 10: Run runner tests**

Run: `cd packages/orchestrator && pnpm vitest run __tests__/policy-runner.test.ts`
Expected: PASS

- [ ] **Step 11: Fix any remaining downstream type errors**

Run: `pnpm build && pnpm test`
Expected: PASS (fix any test fixtures that now need observation field)

- [ ] **Step 12: Update orchestrator architecture doc**

In `docs/architecture/orchestrator.md`, update the `policy.baseline` emission note (around line 188) to mention the full observation payload:

Change:
```
- it emits `policy.baseline` for each started role immediately after `debate.started`, carrying the full baseline `ResolvedPolicy`, clamp notes, preset provenance, translation summary, and warnings
```
To:
```
- it emits `policy.baseline` for each started role immediately after `debate.started`, carrying the full baseline `ResolvedPolicy`, clamp notes, preset provenance, translation summary, warnings, and the full `ProviderObservationResult` (tool view, capability effects, completeness) so that downstream consumers can reconstruct runtime policy state from events alone
- it emits `policy.turn.override` before sending the turn (only when a turn-level override is active) with the same observation payload, and `policy.turn.override.clear` after the turn completes
```

- [ ] **Step 13: Commit**

```bash
git add packages/orchestrator-core/src/orchestrator-events.ts packages/orchestrator-core/__tests__/policy-events.test.ts packages/orchestrator/src/runner.ts packages/orchestrator/__tests__/policy-runner.test.ts docs/architecture/orchestrator.md
git commit -m "feat(events): add observation payload to policy events and emit from runner

Enrich PolicyBaselineEvent and PolicyTurnOverrideEvent with full
ProviderObservationResult. Update runner to emit real observation
data instead of extracting only translation/warnings."
```

---

### Task 2: Track Session-Scoped Per-Role RuntimePolicyState in TUI Store

**Files:**
- Modify: `packages/tui/src/state/types.ts`
- Modify: `packages/tui/src/state/tui-store.ts`
- Modify: `packages/tui/__tests__/tui-store.test.ts`

Currently `policy.baseline` is a no-op in TUI store and `policy.turn.override` only sets `executionMode` string. This task replaces that with proper session-scoped `RuntimePolicyState` tracking. The state is keyed by `debateId` (from `debate.started`) then by role, so multi-session contamination is impossible and the structure matches the spec's per-session per-role requirement.

- [ ] **Step 1: Add session-scoped policyState to TuiState**

In `packages/tui/src/state/types.ts`, add to `TuiState`:

```ts
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";

/** Session-scoped policy state, keyed by debateId then role. */
export interface PolicySessionState {
  debateId: string;
  roles: Record<string, RuntimePolicyState>;
}

export interface TuiState {
  proposer: LiveAgentPanelState;
  challenger: LiveAgentPanelState;
  rounds: TuiRound[];
  judgeResults: JudgeRoundResult[];
  judge: JudgeStripState;
  metrics: MetricsState;
  command: CommandState;
  debateState: DebateState;
  summaryGenerating?: boolean;
  summary?: DebateSummaryView;
  policySession?: PolicySessionState;
}
```

- [ ] **Step 2: Write failing test for policy.baseline tracking with session scope**

In `packages/tui/__tests__/tui-store.test.ts`:

```ts
import type { ProviderObservationResult } from "@crossfire/adapter-core";

const stubObservation: ProviderObservationResult = {
  translation: {
    adapter: "claude",
    nativeSummary: {},
    exactFields: [],
    approximateFields: [],
    unsupportedFields: [],
  },
  toolView: [],
  capabilityEffects: [],
  warnings: [],
  completeness: "partial",
};

it("tracks RuntimePolicyState scoped to active session", () => {
  const store = new TuiStore();
  // debate.started establishes the session
  store.handleEvent(
    ev("debate.started", {
      debateId: "d-20260405-120000",
      config: minimalConfig,
    }),
  );
  store.handleEvent(
    ev("policy.baseline", {
      role: "proposer",
      policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
      clamps: [],
      preset: { value: "research", source: "cli-role" },
      translationSummary: stubObservation.translation,
      warnings: [],
      observation: stubObservation,
    }),
  );
  const state = store.getState();
  expect(state.policySession).toBeDefined();
  expect(state.policySession!.debateId).toBe("d-20260405-120000");
  expect(state.policySession!.roles.proposer).toBeDefined();
  expect(state.policySession!.roles.proposer.baseline.preset.value).toBe("research");
  expect(state.policySession!.roles.proposer.baseline.observation.completeness).toBe("partial");
});

it("resets policySession on new debate.started", () => {
  const store = new TuiStore();
  store.handleEvent(ev("debate.started", { debateId: "d-session-1", config: minimalConfig }));
  store.handleEvent(
    ev("policy.baseline", {
      role: "proposer",
      policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
      clamps: [],
      preset: { value: "research", source: "cli-role" },
      translationSummary: stubObservation.translation,
      warnings: [],
      observation: stubObservation,
    }),
  );
  // New session starts — old policy state must be wiped
  store.handleEvent(ev("debate.started", { debateId: "d-session-2", config: minimalConfig }));
  const state = store.getState();
  expect(state.policySession!.debateId).toBe("d-session-2");
  expect(state.policySession!.roles.proposer).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/tui && pnpm vitest run __tests__/tui-store.test.ts`
Expected: FAIL — policySession not defined.

- [ ] **Step 4: Implement session-scoped policy event handling**

In `packages/tui/src/state/tui-store.ts`:

Update the constructor to leave `policySession` as `undefined` (it is set on `debate.started`).

In the `debate.started` case, initialize a fresh `policySession`:

```ts
case "debate.started": {
  // ... existing debate.started handling ...
  const debateId = (event as { debateId?: string }).debateId;
  if (debateId) {
    this.state.policySession = { debateId, roles: {} };
  }
  break;
}
```

Replace the existing policy event cases:

```ts
case "policy.baseline": {
  const e = event as PolicyBaselineEvent;
  if (!this.state.policySession) break; // no active session
  this.state.policySession.roles[e.role] = {
    baseline: {
      policy: e.policy,
      clamps: [...e.clamps],
      preset: { ...e.preset },
      translationSummary: e.translationSummary,
      warnings: [...e.warnings],
      observation: e.observation,
    },
  };
  // Set initial preset on panel for header display
  if (e.role === "proposer" || e.role === "challenger") {
    this.state[e.role].preset = e.preset.value;
  }
  break;
}
case "policy.turn.override": {
  const e = event as PolicyTurnOverrideEvent;
  if (!this.state.policySession) break;
  const existing = this.state.policySession.roles[e.role];
  if (existing) {
    existing.currentTurnOverride = {
      turnId: e.turnId,
      policy: e.policy,
      preset: e.preset,
      translationSummary: e.translationSummary,
      warnings: [...e.warnings],
      observation: e.observation,
    };
  }
  // Keep backward-compatible preset display for now (Task 6 migrates it)
  if (e.role === "proposer" || e.role === "challenger") {
    this.state[e.role].executionMode = e.preset;
  }
  break;
}
case "policy.turn.override.clear": {
  const e = event as PolicyTurnOverrideClearEvent;
  if (!this.state.policySession) break;
  for (const rps of Object.values(this.state.policySession.roles)) {
    if (rps.currentTurnOverride?.turnId === e.turnId) {
      rps.currentTurnOverride = undefined;
    }
  }
  break;
}
```

Add needed imports at the top of the file:
```ts
import type {
  PolicyBaselineEvent,
  PolicyTurnOverrideEvent,
  PolicyTurnOverrideClearEvent,
} from "@crossfire/orchestrator-core";
```

- [ ] **Step 5: Write tests for override and clear tracking**

```ts
it("tracks policy.turn.override in session-scoped RuntimePolicyState", () => {
  const store = new TuiStore();
  store.handleEvent(ev("debate.started", { debateId: "d-test", config: minimalConfig }));
  store.handleEvent(ev("policy.baseline", {
    role: "proposer",
    policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
    clamps: [],
    preset: { value: "research", source: "cli-role" },
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));
  store.handleEvent(ev("policy.turn.override", {
    role: "proposer",
    turnId: "p-1",
    policy: { preset: "dangerous", roleContract: {}, capabilities: {}, interaction: {} },
    preset: "dangerous",
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));

  const session = store.getState().policySession!;
  expect(session.roles.proposer.currentTurnOverride).toBeDefined();
  expect(session.roles.proposer.currentTurnOverride?.preset).toBe("dangerous");
});

it("clears policy.turn.override on clear event", () => {
  const store = new TuiStore();
  store.handleEvent(ev("debate.started", { debateId: "d-test", config: minimalConfig }));
  store.handleEvent(ev("policy.baseline", {
    role: "proposer",
    policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
    clamps: [],
    preset: { value: "research", source: "cli-role" },
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));
  store.handleEvent(ev("policy.turn.override", {
    role: "proposer",
    turnId: "p-1",
    policy: { preset: "dangerous", roleContract: {}, capabilities: {}, interaction: {} },
    preset: "dangerous",
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));
  store.handleEvent(ev("policy.turn.override.clear", { turnId: "p-1" }));

  const session = store.getState().policySession!;
  expect(session.roles.proposer.currentTurnOverride).toBeUndefined();
  expect(session.roles.proposer.baseline.preset.value).toBe("research");
});

it("ignores policy events before debate.started", () => {
  const store = new TuiStore();
  store.handleEvent(ev("policy.baseline", {
    role: "proposer",
    policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
    clamps: [],
    preset: { value: "research", source: "cli-role" },
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));
  expect(store.getState().policySession).toBeUndefined();
});
```

- [ ] **Step 6: Run tests**

Run: `cd packages/tui && pnpm vitest run __tests__/tui-store.test.ts`
Expected: PASS

- [ ] **Step 7: Update TUI-CLI architecture doc for session-scoped state model**

In `docs/architecture/tui-cli.md`, add or update documentation for the new session-scoped policy state model:

- The TUI store now tracks `PolicySessionState` keyed by `debateId` (from `debate.started`), containing per-role `RuntimePolicyState` entries
- Policy events (`policy.baseline`, `policy.turn.override`, `policy.turn.override.clear`) are no-ops before `debate.started` establishes a session
- A new `debate.started` event resets the policy session, preventing cross-session contamination
- `RuntimePolicyState` is event-derived: baseline is set from `policy.baseline`, overrides are set/cleared from override events

This is a data-flow/interface change in the TUI store, so the architecture doc must be updated in the same commit.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/state/types.ts packages/tui/src/state/tui-store.ts packages/tui/__tests__/tui-store.test.ts docs/architecture/tui-cli.md
git commit -m "feat(tui): track session-scoped per-role RuntimePolicyState from policy events

Introduce PolicySessionState keyed by debateId. Policy events are
no-ops before debate.started. Architecture docs updated for new
session-scoped state model."
```

---

### Task 3: Create Status View Models

**Files:**
- Create: `packages/tui/src/status/status-view-models.ts`
- Create: `packages/tui/__tests__/status/status-view-models.test.ts`

View models take `RuntimePolicyState` (from orchestrator-core) as input and return structured data for rendering. They do not import TUI store. `StatusPolicyView` includes `model` and resolved policy summary per the spec's required output (role, adapter, model, baseline resolved policy, clamps, translation, warnings, active override).

- [ ] **Step 1: Create status directory**

Run: `mkdir -p packages/tui/src/status packages/tui/__tests__/status`

- [ ] **Step 2: Write failing tests for StatusPolicyView**

Create `packages/tui/__tests__/status/status-view-models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";
import type { ProviderObservationResult } from "@crossfire/adapter-core";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import {
  buildStatusPolicyView,
  buildStatusToolsView,
} from "../../src/status/status-view-models.js";

const stubObservation: ProviderObservationResult = {
  translation: {
    adapter: "claude",
    nativeSummary: { permissionMode: "default" },
    exactFields: ["approval"],
    approximateFields: [],
    unsupportedFields: [],
  },
  toolView: [
    { name: "Bash", source: "builtin", status: "allowed", reason: "adapter_default" },
    { name: "Read", source: "builtin", status: "allowed", reason: "adapter_default" },
  ],
  capabilityEffects: [
    { field: "capabilities.shell", status: "applied" },
  ],
  warnings: [
    { field: "interaction.limits", adapter: "claude", reason: "approximate", message: "maxTurns is approximate" },
  ],
  completeness: "partial",
};

function makeState(overrides?: Partial<RuntimePolicyState>): RuntimePolicyState {
  return {
    baseline: {
      policy: makeResolvedPolicy(),
      clamps: [{ field: "capabilities.shell", before: "exec", after: "off", reason: "role_ceiling" }],
      preset: { value: "research", source: "cli-role" },
      translationSummary: stubObservation.translation,
      warnings: [...stubObservation.warnings],
      observation: stubObservation,
    },
    ...overrides,
  };
}

describe("buildStatusPolicyView", () => {
  it("returns baseline policy summary with model and resolved policy", () => {
    const view = buildStatusPolicyView("proposer", "claude", "claude-sonnet-4-20250514", makeState());
    expect(view.role).toBe("proposer");
    expect(view.adapter).toBe("claude");
    expect(view.model).toBe("claude-sonnet-4-20250514");
    expect(view.baseline.preset.value).toBe("research");
    expect(view.baseline.policy).toBeDefined();
    expect(view.baseline.policy.capabilities).toBeDefined();
    expect(view.baseline.clamps).toHaveLength(1);
    expect(view.baseline.warnings).toHaveLength(1);
    expect(view.override).toBeUndefined();
  });

  it("includes override when present", () => {
    const state = makeState({
      currentTurnOverride: {
        turnId: "p-1",
        policy: makeResolvedPolicy("dangerous"),
        preset: "dangerous",
        translationSummary: stubObservation.translation,
        warnings: [],
        observation: stubObservation,
      },
    });
    const view = buildStatusPolicyView("proposer", "claude", "claude-sonnet-4-20250514", state);
    expect(view.override).toBeDefined();
    expect(view.override?.turnId).toBe("p-1");
    expect(view.override?.preset).toBe("dangerous");
    expect(view.override?.policy).toBeDefined();
  });
});

describe("buildStatusToolsView", () => {
  it("returns baseline tool view by default", () => {
    const view = buildStatusToolsView("proposer", "claude", makeState());
    expect(view.source).toBe("baseline");
    expect(view.toolView).toHaveLength(2);
    expect(view.completeness).toBe("partial");
  });

  it("returns override tool view when override is active", () => {
    const overrideObservation = {
      ...stubObservation,
      toolView: [
        { name: "Bash", source: "builtin" as const, status: "allowed" as const, reason: "adapter_default" as const },
      ],
    };
    const state = makeState({
      currentTurnOverride: {
        turnId: "p-1",
        policy: makeResolvedPolicy("dangerous"),
        preset: "dangerous",
        translationSummary: overrideObservation.translation,
        warnings: [],
        observation: overrideObservation,
      },
    });
    const view = buildStatusToolsView("proposer", "claude", state);
    expect(view.source).toBe("override");
    expect(view.toolView).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/tui && pnpm vitest run __tests__/status/status-view-models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement status view models**

Create `packages/tui/src/status/status-view-models.ts`:

```ts
import type {
  CapabilityEffectRecord,
  PolicyClampNote,
  PolicyPreset,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  PresetSource,
  ResolvedPolicy,
  ToolInspectionRecord,
} from "@crossfire/adapter-core";
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";

export interface StatusPolicyView {
  role: string;
  adapter: string;
  model: string;
  baseline: {
    preset: { value: PolicyPreset; source: PresetSource };
    policy: ResolvedPolicy;
    clamps: readonly PolicyClampNote[];
    translationSummary: PolicyTranslationSummary;
    warnings: readonly PolicyTranslationWarning[];
  };
  override?: {
    turnId: string;
    preset: PolicyPreset;
    policy: ResolvedPolicy;
    translationSummary: PolicyTranslationSummary;
    warnings: readonly PolicyTranslationWarning[];
  };
}

export interface StatusToolsView {
  role: string;
  adapter: string;
  source: "baseline" | "override";
  toolView: readonly ToolInspectionRecord[];
  capabilityEffects: readonly CapabilityEffectRecord[];
  completeness: string;
  warnings: readonly PolicyTranslationWarning[];
}

export function buildStatusPolicyView(
  role: string,
  adapter: string,
  model: string,
  state: RuntimePolicyState,
): StatusPolicyView {
  const view: StatusPolicyView = {
    role,
    adapter,
    model,
    baseline: {
      preset: state.baseline.preset,
      policy: state.baseline.policy,
      clamps: state.baseline.clamps,
      translationSummary: state.baseline.translationSummary,
      warnings: state.baseline.warnings,
    },
  };
  if (state.currentTurnOverride) {
    view.override = {
      turnId: state.currentTurnOverride.turnId,
      preset: state.currentTurnOverride.preset,
      policy: state.currentTurnOverride.policy,
      translationSummary: state.currentTurnOverride.translationSummary,
      warnings: state.currentTurnOverride.warnings,
    };
  }
  return view;
}

export function buildStatusToolsView(
  role: string,
  adapter: string,
  state: RuntimePolicyState,
): StatusToolsView {
  const activeOverride = state.currentTurnOverride;
  const observation = activeOverride
    ? activeOverride.observation
    : state.baseline.observation;
  const warnings = activeOverride
    ? activeOverride.warnings
    : state.baseline.warnings;

  return {
    role,
    adapter,
    source: activeOverride ? "override" : "baseline",
    toolView: observation.toolView,
    capabilityEffects: observation.capabilityEffects,
    completeness: observation.completeness,
    warnings,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/tui && pnpm vitest run __tests__/status/status-view-models.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/status/status-view-models.ts packages/tui/__tests__/status/status-view-models.test.ts
git commit -m "feat(tui): add status policy and tools view models"
```

---

### Task 4: Create Status Text Renderers

**Files:**
- Create: `packages/tui/src/status/status-renderers.ts`
- Create: `packages/tui/__tests__/status/status-renderers.test.ts`

These render `StatusPolicyView` and `StatusToolsView` into text strings, following the same patterns as `packages/cli/src/commands/inspection-renderers.ts`. The policy renderer must display model, resolved policy capabilities/interaction summary, and translation details — not just preset and warnings.

- [ ] **Step 1: Write failing tests for renderStatusPolicy**

Create `packages/tui/__tests__/status/status-renderers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StatusPolicyView, StatusToolsView } from "../../src/status/status-view-models.js";
import {
  renderStatusPolicy,
  renderStatusTools,
} from "../../src/status/status-renderers.js";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";

const basePolicyView: StatusPolicyView = {
  role: "proposer",
  adapter: "claude",
  model: "claude-sonnet-4-20250514",
  baseline: {
    preset: { value: "research", source: "cli-role" },
    policy: makeResolvedPolicy(),
    clamps: [{ field: "capabilities.shell", before: "exec", after: "off", reason: "role_ceiling" }],
    translationSummary: {
      adapter: "claude",
      nativeSummary: { permissionMode: "default" },
      exactFields: ["approval"],
      approximateFields: [],
      unsupportedFields: [],
    },
    warnings: [
      { field: "limits", adapter: "claude", reason: "approximate", message: "maxTurns is approximate" },
    ],
  },
};

describe("renderStatusPolicy", () => {
  it("renders baseline policy summary with model and resolved policy", () => {
    const text = renderStatusPolicy([basePolicyView]);
    expect(text).toContain("proposer");
    expect(text).toContain("claude");
    expect(text).toContain("claude-sonnet-4-20250514");
    expect(text).toContain("research");
    expect(text).toContain("cli-role");
    expect(text).toContain("capabilities.shell");
    expect(text).toContain("maxTurns is approximate");
  });

  it("renders resolved policy capabilities summary", () => {
    const text = renderStatusPolicy([basePolicyView]);
    // Should display capability fields from the resolved policy
    expect(text).toMatch(/capabilities/i);
  });

  it("renders override section when present", () => {
    const viewWithOverride: StatusPolicyView = {
      ...basePolicyView,
      override: {
        turnId: "p-1",
        preset: "dangerous",
        policy: makeResolvedPolicy("dangerous"),
        translationSummary: basePolicyView.baseline.translationSummary,
        warnings: [],
      },
    };
    const text = renderStatusPolicy([viewWithOverride]);
    expect(text).toContain("Override");
    expect(text).toContain("p-1");
    expect(text).toContain("dangerous");
  });

  it("shows not-yet-available when views array is empty", () => {
    const text = renderStatusPolicy([]);
    expect(text).toContain("not yet available");
  });

  it("renders evidence section when present on resolved policy (forward-compat for D2)", () => {
    // D2 will add ResolvedPolicy.evidence as a top-level section.
    // This test verifies the renderer is forward-compatible: when evidence
    // fields appear, they are displayed. Until D2 lands, ResolvedPolicy has
    // no evidence section, so this test uses a cast to simulate D2 shape.
    const policyWithEvidence = {
      ...basePolicyView.baseline.policy,
      evidence: { bar: "high", requiresCitation: true },
    };
    const viewWithEvidence: StatusPolicyView = {
      ...basePolicyView,
      baseline: { ...basePolicyView.baseline, policy: policyWithEvidence as StatusPolicyView["baseline"]["policy"] },
    };
    const text = renderStatusPolicy([viewWithEvidence]);
    expect(text).toContain("Evidence");
    expect(text).toContain("bar");
    expect(text).toContain("high");
  });

  it("omits evidence section when not present (pre-D2 resolved policy)", () => {
    // Before D2, ResolvedPolicy has no evidence field. Renderer must not crash.
    const text = renderStatusPolicy([basePolicyView]);
    expect(text).not.toContain("Evidence:");
  });
});

describe("renderStatusTools", () => {
  const baseToolsView: StatusToolsView = {
    role: "proposer",
    adapter: "claude",
    source: "baseline",
    toolView: [
      { name: "Bash", source: "builtin", status: "allowed", reason: "adapter_default" },
      { name: "Read", source: "builtin", status: "blocked", reason: "capability_policy", capabilityField: "capabilities.shell" },
    ],
    capabilityEffects: [{ field: "capabilities.shell", status: "applied" }],
    completeness: "partial",
    warnings: [],
  };

  it("renders tool view with status icons", () => {
    const text = renderStatusTools([baseToolsView]);
    expect(text).toContain("proposer");
    expect(text).toContain("Bash");
    expect(text).toContain("Read");
    expect(text).toContain("partial");
  });

  it("labels source as baseline or override", () => {
    const text = renderStatusTools([baseToolsView]);
    expect(text).toContain("baseline");

    const overrideView = { ...baseToolsView, source: "override" as const };
    const text2 = renderStatusTools([overrideView]);
    expect(text2).toContain("override");
  });

  it("includes best-effort disclaimer", () => {
    const text = renderStatusTools([baseToolsView]);
    expect(text).toMatch(/best.effort/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tui && pnpm vitest run __tests__/status/status-renderers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement status renderers**

Create `packages/tui/src/status/status-renderers.ts`:

```ts
import type { ResolvedPolicy } from "@crossfire/adapter-core";
import type { StatusPolicyView, StatusToolsView } from "./status-view-models.js";

function renderPolicySummary(policy: ResolvedPolicy): string[] {
  const lines: string[] = [];
  const caps = policy.capabilities;
  if (caps) {
    const entries = Object.entries(caps).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      lines.push("  Capabilities:");
      for (const [k, v] of entries) {
        lines.push(`    ${k}: ${String(v)}`);
      }
    }
  }
  const interaction = policy.interaction;
  if (interaction) {
    const entries = Object.entries(interaction).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      lines.push("  Interaction:");
      for (const [k, v] of entries) {
        lines.push(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  // Forward-compatible: render evidence section when D2 adds it to ResolvedPolicy.
  // Currently evidence lives only in roleContract.evidenceBar; D2 will promote it
  // to a top-level ResolvedPolicy.evidence section. This block is a no-op until then.
  const evidence = (policy as Record<string, unknown>).evidence;
  if (evidence && typeof evidence === "object") {
    const entries = Object.entries(evidence).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      lines.push("  Evidence:");
      for (const [k, v] of entries) {
        lines.push(`    ${k}: ${String(v)}`);
      }
    }
  }
  return lines;
}

export function renderStatusPolicy(views: StatusPolicyView[]): string {
  if (views.length === 0) {
    return "Policy state not yet available.";
  }

  const lines: string[] = [];
  for (const view of views) {
    lines.push(`\n=== ${view.role} (${view.adapter}) model=${view.model} ===`);
    lines.push(`  Preset: ${view.baseline.preset.value} (${view.baseline.preset.source})`);

    lines.push(...renderPolicySummary(view.baseline.policy));

    if (view.baseline.clamps.length > 0) {
      lines.push("  Clamps:");
      for (const c of view.baseline.clamps) {
        lines.push(`    ${c.field}: ${c.before} -> ${c.after} (${c.reason})`);
      }
    }

    const t = view.baseline.translationSummary;
    lines.push(`  Translation: ${JSON.stringify(t.nativeSummary)}`);

    if (view.baseline.warnings.length > 0) {
      lines.push("  Warnings:");
      for (const w of view.baseline.warnings) {
        lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
      }
    }

    if (view.override) {
      lines.push(`  Override: turnId=${view.override.turnId} preset=${view.override.preset}`);
      lines.push(...renderPolicySummary(view.override.policy));
      if (view.override.warnings.length > 0) {
        lines.push("  Override Warnings:");
        for (const w of view.override.warnings) {
          lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
        }
      }
    }
  }
  return lines.join("\n");
}

export function renderStatusTools(views: StatusToolsView[]): string {
  if (views.length === 0) {
    return "Tool state not yet available.";
  }

  const lines: string[] = ["(Best-effort observation \u2014 not an execution guarantee)"];
  for (const view of views) {
    lines.push(`\n=== ${view.role} (${view.adapter}) ===`);
    lines.push(`  Source: ${view.source}`);
    lines.push(`  Completeness: ${view.completeness}`);

    if (view.capabilityEffects.length > 0) {
      lines.push("  Capability Effects:");
      for (const e of view.capabilityEffects) {
        lines.push(`    [${e.status}] ${e.field}: ${e.details ?? ""}`);
      }
    }

    if (view.toolView.length > 0) {
      lines.push("  Tools:");
      for (const t of view.toolView) {
        const icon = t.status === "allowed" ? "\u2713" : "\u2717";
        const suffix = t.capabilityField ? ` (${t.capabilityField})` : "";
        lines.push(`    ${icon} ${t.name} [${t.source}] ${t.status} \u2014 ${t.reason}${suffix}`);
      }
    }

    if (view.warnings.length > 0) {
      lines.push("  Warnings:");
      for (const w of view.warnings) {
        lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
      }
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/tui && pnpm vitest run __tests__/status/status-renderers.test.ts`
Expected: PASS

- [ ] **Step 5: Add index export**

Create `packages/tui/src/status/index.ts`:

```ts
export { buildStatusPolicyView, buildStatusToolsView } from "./status-view-models.js";
export type { StatusPolicyView, StatusToolsView } from "./status-view-models.js";
export { renderStatusPolicy, renderStatusTools } from "./status-renderers.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/status/ packages/tui/__tests__/status/status-renderers.test.ts
git commit -m "feat(tui): add status text renderers for policy and tools"
```

---

### Task 5: Add /status Command Parsing and Dispatch

**Files:**
- Modify: `packages/tui/src/components/command-input.tsx`
- Modify: `packages/cli/src/wiring/live-command-handler.ts`
- Modify: `packages/cli/__tests__/live-command-handler.test.ts`
- Modify: `packages/tui/__tests__/command-input.test.tsx`
- Modify: `docs/architecture/tui-cli.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

Add `/status policy` and `/status tools` to the command parsing and dispatch pipeline. The handler reads from the session-scoped `policySession` and adapter metadata to build view models. Both the parser and the full dispatch path must have dedicated tests. This is a user-facing CLI change, so README and TUI architecture docs are updated in the same commit.

- [ ] **Step 1: Write failing tests for /status command parsing**

In `packages/tui/__tests__/command-input.test.tsx`, add tests:

```ts
it("parses /status policy", () => {
  const result = parseCommand("/status policy", "live");
  expect(result).toEqual({ type: "status", target: "policy" });
});

it("parses /status tools", () => {
  const result = parseCommand("/status tools", "live");
  expect(result).toEqual({ type: "status", target: "tools" });
});

it("returns unknown for /status without target", () => {
  const result = parseCommand("/status", "live");
  expect(result).toEqual({ type: "unknown", raw: "/status" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tui && pnpm vitest run __tests__/command-input.test.tsx`
Expected: FAIL — type "status" not in ParsedCommand.

- [ ] **Step 3: Add status to ParsedCommand type**

In `packages/tui/src/components/command-input.tsx`, add to the `ParsedCommand` union:

```ts
| { type: "status"; target: "policy" | "tools" }
```

- [ ] **Step 4: Add /status parsing in parseCommand()**

In `packages/tui/src/components/command-input.tsx`, add a case in the `parseCommand()` switch:

```ts
case "/status": {
  const target = parts[1];
  if (target === "policy" || target === "tools") {
    return { type: "status", target };
  }
  return { type: "unknown", raw: input };
}
```

- [ ] **Step 5: Run parsing tests**

Run: `cd packages/tui && pnpm vitest run __tests__/command-input.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire /status into live command handler**

In `packages/cli/src/wiring/live-command-handler.ts`, add handling for the status command. The handler reads from the TUI store's `policySession` and projects view models using adapter metadata for model/adapter ID.

In the command handler function, add the status case:

```ts
case "status": {
  const session = store.getState().policySession;
  if (!session) {
    store.pushCommandOutput("Policy state not yet available (no active session).");
    break;
  }
  const roleEntries = Object.entries(session.roles);

  if (cmd.target === "policy") {
    const views = roleEntries.map(([role, state]) => {
      const adapterEntry = adapters[role as keyof typeof adapters];
      const adapterId = adapterEntry?.session?.adapterId ?? "unknown";
      const model = adapterEntry?.session?.model ?? "unknown";
      return buildStatusPolicyView(role, adapterId, model, state);
    });
    const text = renderStatusPolicy(views);
    store.pushCommandOutput(text);
  } else {
    const views = roleEntries.map(([role, state]) => {
      const adapterId = adapters[role as keyof typeof adapters]?.session?.adapterId ?? "unknown";
      return buildStatusToolsView(role, adapterId, state);
    });
    const text = renderStatusTools(views);
    store.pushCommandOutput(text);
  }
  break;
}
```

Add imports for view models and renderers at the top:

```ts
import {
  buildStatusPolicyView,
  buildStatusToolsView,
  renderStatusPolicy,
  renderStatusTools,
} from "@crossfire/tui/status";
```

- [ ] **Step 7: Add pushCommandOutput method to TuiStore**

In `packages/tui/src/state/tui-store.ts`, add a method to push command output text to the TUI display:

```ts
pushCommandOutput(text: string): void {
  this.state.command.lastOutput = text;
  this.notify();
}
```

In `packages/tui/src/state/types.ts`, add to `CommandState`:

```ts
export interface CommandState {
  mode: string;
  lastOutput?: string;
}
```

- [ ] **Step 8: Write failing dispatch-path tests for /status commands**

In `packages/cli/__tests__/live-command-handler.test.ts`, add tests that exercise the full dispatch: session-scoped store state → handler receives status command → builds view model → pushes rendered output to store. These tests use the existing mock patterns in the file:

```ts
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";
import type { ProviderObservationResult } from "@crossfire/adapter-core";

const stubObservation: ProviderObservationResult = {
  translation: {
    adapter: "claude",
    nativeSummary: {},
    exactFields: [],
    approximateFields: [],
    unsupportedFields: [],
  },
  toolView: [
    { name: "Bash", source: "builtin", status: "allowed", reason: "adapter_default" },
  ],
  capabilityEffects: [],
  warnings: [
    { field: "limits", adapter: "claude", reason: "approximate", message: "approx" },
  ],
  completeness: "partial",
};

const stubPolicySession = {
  debateId: "d-test",
  roles: {
    proposer: {
      baseline: {
        policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
        clamps: [],
        preset: { value: "research", source: "cli-role" },
        translationSummary: stubObservation.translation,
        warnings: [...stubObservation.warnings],
        observation: stubObservation,
      },
    } as RuntimePolicyState,
  },
};

it("/status policy dispatches through session-scoped store and pushes rendered output", () => {
  let captured: string | undefined;
  const store = {
    getState: () => ({
      ...minimalState,
      policySession: stubPolicySession,
    }),
    pushCommandOutput: (text: string) => { captured = text; },
  } as unknown as TuiStore;

  const handler = createLiveCommandHandler({
    adapters,
    bus: mockBus,
    store,
    triggerShutdown: vi.fn(),
    getUserQuitHandler: () => undefined,
  });
  handler({ type: "status", target: "policy" });

  expect(captured).toBeDefined();
  expect(captured).toContain("proposer");
  expect(captured).toContain("research");
  expect(captured).toContain("cli-role");
});

it("/status tools dispatches through session-scoped store and pushes rendered output", () => {
  let captured: string | undefined;
  const store = {
    getState: () => ({
      ...minimalState,
      policySession: stubPolicySession,
    }),
    pushCommandOutput: (text: string) => { captured = text; },
  } as unknown as TuiStore;

  const handler = createLiveCommandHandler({
    adapters,
    bus: mockBus,
    store,
    triggerShutdown: vi.fn(),
    getUserQuitHandler: () => undefined,
  });
  handler({ type: "status", target: "tools" });

  expect(captured).toBeDefined();
  expect(captured).toContain("proposer");
  expect(captured).toContain("Bash");
  expect(captured).toContain("partial");
  expect(captured).toMatch(/best.effort/i);
});

it("/status policy before session shows not-available message", () => {
  let captured: string | undefined;
  const store = {
    getState: () => ({ ...minimalState, policySession: undefined }),
    pushCommandOutput: (text: string) => { captured = text; },
  } as unknown as TuiStore;

  const handler = createLiveCommandHandler({
    adapters,
    bus: mockBus,
    store,
    triggerShutdown: vi.fn(),
    getUserQuitHandler: () => undefined,
  });
  handler({ type: "status", target: "policy" });

  expect(captured).toContain("not yet available");
});
```

- [ ] **Step 9: Run dispatch-path tests to verify they fail**

Run: `cd packages/cli && pnpm vitest run __tests__/live-command-handler.test.ts`
Expected: FAIL — status case not yet implemented (or handler does not handle type "status").

- [ ] **Step 10: Run build and all tests**

Run: `pnpm build && pnpm test`
Expected: PASS (dispatch-path tests now pass because Step 6 added the implementation)

- [ ] **Step 11: Update TUI-CLI architecture doc for /status commands**

In `docs/architecture/tui-cli.md`, add a section documenting:
- `/status policy` and `/status tools` as TUI live commands (not standalone CLI subcommands)
- snapshot-at-invocation semantics (reads `store.getState()` at command time)
- view model architecture: `buildStatusPolicyView` and `buildStatusToolsView` are decoupled from TUI store internals, take `RuntimePolicyState` as input

Update the live panel header description (line ~56) to note that `/status policy` is available for full provenance details while the header shows only the effective preset.

Note: The session-scoping architecture was already documented in Task 2. This step adds the `/status` command surface and view model docs.

- [ ] **Step 12: Update README.md**

In `README.md`, in the TUI commands section or the live commands area, add `/status policy` and `/status tools` with brief descriptions:
- `/status policy` — shows effective policy state per role (preset, capabilities, clamps, translation, warnings, active override)
- `/status tools` — shows effective tool surface per role (tool view, capability effects, completeness; best-effort observation)

- [ ] **Step 13: Update README.zh-CN.md**

Mirror the README.md changes in the Chinese README, translating the command descriptions.

- [ ] **Step 14: Commit**

```bash
git add packages/tui/src/components/command-input.tsx packages/cli/src/wiring/live-command-handler.ts packages/cli/__tests__/live-command-handler.test.ts packages/tui/src/state/tui-store.ts packages/tui/src/state/types.ts packages/tui/__tests__/command-input.test.tsx docs/architecture/tui-cli.md README.md README.zh-CN.md
git commit -m "feat(tui): add /status policy and /status tools command parsing and dispatch

Wire new live commands into TUI command parser and live-command-handler.
Dispatch-path tests cover full store→view-model→render→output pipeline.
Update architecture docs and READMEs for user-facing /status surface."
```

---

### Task 6: Replace executionMode Display with Effective Preset

**Files:**
- Modify: `packages/tui/src/components/agent-panel.tsx`
- Modify: `packages/tui/src/render/render-blocks.ts`
- Modify: `packages/tui/src/render/line-buffer.ts`
- Modify: `packages/tui/src/render/tool-status.ts`
- Modify: `packages/tui/src/state/types.ts`
- Modify: `packages/tui/__tests__/tui-store.test.ts`
- Modify: `packages/tui/__tests__/render/render-blocks.test.ts`
- Modify: `docs/architecture/tui-cli.md`
- Modify: `docs/architecture/execution-modes.md`

Replace the legacy `executionMode` string display with the effective preset derived from `RuntimePolicyState`. The panel header should show the effective preset; full provenance is reserved for `/status policy`. Architecture docs updated in the same commit since this changes the TUI display contract.

- [ ] **Step 1: Update RenderBlock agent-header to use preset instead of executionMode**

In `packages/tui/src/render/render-blocks.ts`, change the `agent-header` block to carry `preset` instead of `executionMode`:

Where the block is built (line ~52 and ~92), replace:
```ts
executionMode: snap.executionMode,
```
with:
```ts
preset: snap.preset,
```

And:
```ts
executionMode: state.executionMode,
```
with:
```ts
preset: state.preset,
```

Update the `AgentHeaderBlock` type (or wherever the block shape is defined) to use `preset?: string` instead of `executionMode?: string`.

- [ ] **Step 2: Update line-buffer rendering**

In `packages/tui/src/render/line-buffer.ts` (around line 218-220), replace:

```ts
const mode = block.executionMode
  ? ` [mode: ${block.executionMode}]`
  : "";
```

with:

```ts
const presetLabel = block.preset
  ? ` [${block.preset}]`
  : "";
```

And update the assembled string to use `presetLabel` instead of `mode`.

- [ ] **Step 3: Update agent-panel.tsx**

In `packages/tui/src/components/agent-panel.tsx`:

Replace `modeSuffix()` (line 74-76):
```ts
function presetSuffix(preset?: string): string {
  return preset ? ` [${preset}]` : "";
}
```

Update all references from `modeSuffix(state.executionMode)` to `presetSuffix(state.preset)` and `modeSuffix(snapshot.executionMode)` to `presetSuffix(snapshot.preset)`.

- [ ] **Step 4: Update tool-status.ts**

In `packages/tui/src/render/tool-status.ts` (line ~121), replace:

```ts
const modeSuffix = panel.executionMode ? ` [${panel.executionMode}]` : "";
```

with:

```ts
const presetSuffix = panel.preset ? ` [${panel.preset}]` : "";
```

And update the string assembly.

- [ ] **Step 5: Update LiveAgentPanelState and AgentTurnSnapshot**

In `packages/tui/src/state/types.ts`:

In `LiveAgentPanelState`, replace `executionMode?: string` with `preset?: string`.

In `AgentTurnSnapshot`, replace `executionMode?: string` with `preset?: string`.

- [ ] **Step 6: Update TUI store to set preset instead of executionMode**

In `packages/tui/src/state/tui-store.ts`:

Where `defaultAgentPanel()` sets `executionMode: undefined`, change to `preset: undefined`.

In the `policy.turn.override` case (Task 2 wrote `this.state[e.role].executionMode = e.preset`), change to:
```ts
this.state[e.role as "proposer" | "challenger"].preset = e.preset;
```

In the `policy.baseline` case (Task 2 already sets `this.state[e.role].preset = e.preset.value`), verify it is correct.

In `round.started` where `executionMode` is cleared, clear `preset` instead (or remove the clearing since preset should persist across rounds from baseline).

In the snapshot-building code, replace `executionMode` with `preset`.

- [ ] **Step 7: Update all tests that reference executionMode**

Update test assertions and fixtures in:
- `packages/tui/__tests__/tui-store.test.ts` — change `executionMode` to `preset`
- `packages/tui/__tests__/render/render-blocks.test.ts` — change block assertions
- `packages/tui/__tests__/agent-panel.test.tsx` — change snapshot data
- `packages/tui/__tests__/render/build-panel-lines.test.ts` — change assertions
- `packages/tui/__tests__/metrics-bar.test.tsx` — change fixture data

Search for all `executionMode` references in `packages/tui/` and replace.

- [ ] **Step 8: Run full test suite**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 9: Update architecture docs for preset display**

In `docs/architecture/tui-cli.md`, update line ~56:

Change:
```
- live proposer / challenger headers now append the effective execution mode inline as `Role [provider] [mode: ...]`, so the mode is visible without requiring a separate status row
```
To:
```
- live proposer / challenger headers append the effective preset inline as `Role [provider] [preset]`; full provenance (source, clamps, translation) is available via `/status policy`
```

In `docs/architecture/execution-modes.md`, update line ~162:

Change:
```
- TUI: live panels show the current effective mode in the header/status text
```
To:
```
- TUI: live panels show the current effective preset in the header (not mode); `/status policy` shows full provenance
```

- [ ] **Step 10: Commit**

```bash
git add packages/tui/ docs/architecture/tui-cli.md docs/architecture/execution-modes.md
git commit -m "refactor(tui): replace executionMode display with effective preset from policy state

Panel headers now show [preset] instead of [mode: ...]. Full policy
provenance is available via /status policy. Architecture docs updated."
```

---

### Task 7: Add Warning Badge to Panel Headers

**Files:**
- Modify: `packages/tui/src/render/line-buffer.ts`
- Modify: `packages/tui/src/components/agent-panel.tsx`
- Modify: `packages/tui/src/render/render-blocks.ts`
- Create: `packages/tui/__tests__/status/warning-badge.test.ts`

Add an optional warning count badge to panel headers where low-cost and non-disruptive.

- [ ] **Step 1: Write failing test for warning badge rendering**

Create `packages/tui/__tests__/status/warning-badge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatWarningBadge } from "../../src/status/warning-badge.js";

describe("formatWarningBadge", () => {
  it("returns empty string for zero warnings", () => {
    expect(formatWarningBadge(0)).toBe("");
  });

  it("returns badge for non-zero warnings", () => {
    expect(formatWarningBadge(2)).toBe(" \u26a02");
  });

  it("returns badge for one warning", () => {
    expect(formatWarningBadge(1)).toBe(" \u26a01");
  });
});
```

- [ ] **Step 2: Implement warning badge utility**

Create `packages/tui/src/status/warning-badge.ts`:

```ts
export function formatWarningBadge(count: number): string {
  if (count === 0) return "";
  return ` \u26a0${count}`;
}
```

Export from `packages/tui/src/status/index.ts`:
```ts
export { formatWarningBadge } from "./warning-badge.js";
```

- [ ] **Step 3: Pass warning count into render blocks**

In `packages/tui/src/render/render-blocks.ts`, add `warningCount?: number` to the agent-header block shape. Compute it from TuiState's policySession:

```ts
// In liveStateToBlocks(), look up warning count from policySession
const roleState = policySession?.roles?.[state.role];
const warningCount = roleState?.baseline?.warnings?.length ?? 0;
```

Note: `liveStateToBlocks` will need access to `policySession`. Check its current signature and add the parameter if needed.

- [ ] **Step 4: Render warning badge in line-buffer**

In `packages/tui/src/render/line-buffer.ts`, after the preset label, append the badge:

```ts
const badge = formatWarningBadge(block.warningCount ?? 0);
// Use in assembled header: `${icon} ${label}${agent}${presetLabel}${badge}`
```

Import `formatWarningBadge` from the status module.

- [ ] **Step 5: Render warning badge in agent-panel.tsx**

In the live mode header, append the badge after the preset suffix. Derive warning count from the store's `policySession` for the current role.

- [ ] **Step 6: Run tests**

Run: `cd packages/tui && pnpm vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tui/
git commit -m "feat(tui): add warning count badge to agent panel headers"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| `/status policy` TUI live command | Tasks 4, 5 |
| `/status tools` TUI live command | Tasks 4, 5 |
| Event-derived RuntimePolicyState per-session per-role | Tasks 1, 2 |
| Observation payload in baseline/override events | Task 1 |
| View models independent of TUI store | Task 3 |
| Status renderers share patterns with inspect renderers | Task 4 |
| Snapshot-at-invocation semantics | Task 5 (store.getState() is point-in-time) |
| Replace executionMode with effective preset | Task 6 |
| Header shows preset only, provenance reserved for /status | Task 6 |
| Warning badge on panel headers | Task 7 |
| `/status policy` shows model and resolved policy summary | Tasks 3, 4 |
| Architecture docs updated in behavior-changing commits | Tasks 1, 2, 5, 6 |
| README updated for user-facing /status commands | Task 5 |
| Session-scoped policy state (no cross-session contamination) | Task 2 |
| Dispatch-path test for /status commands | Task 5 |
| Evidence forward-compat in /status policy renderer | Task 4 |

### Placeholder scan

No TBD/TODO items. All steps have concrete code.

### Type consistency check

- `RuntimePolicyState` used consistently across Tasks 1, 2, 3, 4
- `ProviderObservationResult` added to events in Task 1, consumed in Tasks 2, 3
- `StatusPolicyView` / `StatusToolsView` defined in Task 3, consumed in Tasks 4, 5
- `StatusPolicyView` includes `model: string` — built from `adapterEntry.session.model` in Task 5
- `PolicySessionState` defined in Task 2, consumed in Tasks 5, 6, 7
- `ParsedCommand` extended in Task 5, handled in Task 5
- `preset` replaces `executionMode` in Task 6 across all TUI types and renderers

### Review findings addressed

1. **Docs folded into behavior-changing tasks**: Task 1 updates `orchestrator.md`, Task 2 updates `tui-cli.md` (session-scoped state model), Task 5 updates `tui-cli.md` (commands) + READMEs, Task 6 updates `tui-cli.md` + `execution-modes.md`. No standalone docs task.
2. **Session-scoped policyState**: Task 2 introduces `PolicySessionState` with `debateId` + `roles`, initialized on `debate.started`, reset on new session. Policy events are no-ops before session start. Architecture doc updated in same commit.
3. **Task 1 is atomic**: Event type changes and runner emission changes land in the same commit. No broken intermediate checkpoint.
4. **`/status policy` covers full spec contract**: `StatusPolicyView` includes `model`, `buildStatusPolicyView` takes model parameter, renderer displays model + resolved policy capabilities/interaction/evidence summary + translation + clamps + warnings.
5. **Dispatch-path tests**: Task 5 adds dedicated tests in `live-command-handler.test.ts` that exercise the full store→view-model→render→pushCommandOutput pipeline for both `/status policy` and `/status tools`, plus a no-session guard test.
6. **Evidence forward-compat**: Task 4 renderer includes a forward-compatible evidence section that renders `ResolvedPolicy.evidence` when present (D2 adds it). Tests verify it renders when present and is a no-op when absent.
