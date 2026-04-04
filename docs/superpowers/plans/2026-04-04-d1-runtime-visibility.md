# D1 — Runtime Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime policy state visible through `/status policy` and `/status tools` TUI live commands, and replace legacy `executionMode` display with effective preset from event-derived state.

**Architecture:** Enrich policy events with observation payload, track per-role `RuntimePolicyState` in TUI store, expose it through decoupled view models and text renderers, and wire `/status` commands into the existing TUI command dispatch pipeline.

**Tech Stack:** TypeScript, Vitest, Ink (React), Commander.js, pnpm monorepo

---

### Task 1: Enrich Event Types with Observation Payload

**Files:**
- Modify: `packages/orchestrator-core/src/orchestrator-events.ts`
- Modify: `packages/orchestrator-core/__tests__/policy-events.test.ts`

The current `PolicyBaselineEvent` and `PolicyTurnOverrideEvent` carry `translationSummary` and `warnings` but not `toolView`, `capabilityEffects`, or `completeness`. The spec requires `/status tools` to render from event-derived state, so the full `ProviderObservationResult` must be in the events and `RuntimePolicyState`.

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/orchestrator-core && pnpm vitest run __tests__/policy-events.test.ts`
Expected: PASS

- [ ] **Step 6: Fix any downstream type errors**

Run: `pnpm build`

The new required `observation` field will cause type errors in:
- `packages/orchestrator/src/runner.ts` (event emission)
- `packages/tui/src/state/tui-store.ts` (event handling)
- Tests that construct these events

For now, only fix the minimum to make `pnpm build` pass in `orchestrator-core`. Runner and TUI fixes are in subsequent tasks. If the build requires temporary stubs, use `observation: undefined as unknown as ProviderObservationResult` in runner.ts emission sites — Task 2 will replace these with real observation data.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator-core/src/orchestrator-events.ts packages/orchestrator-core/__tests__/policy-events.test.ts
git commit -m "feat(events): add observation payload to policy baseline and override events"
```

---

### Task 2: Emit Full Observation in Runner Events

**Files:**
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: `packages/orchestrator/__tests__/policy-runner.test.ts`

The runner already computes observation via `getObservationForPolicy()` (line ~125-141) but only extracts `translation` and `warnings` into events. This task makes it emit the full `ProviderObservationResult`.

- [ ] **Step 1: Write failing test for observation in emitted baseline event**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/orchestrator && pnpm vitest run __tests__/policy-runner.test.ts`
Expected: FAIL — observation is undefined or missing fields.

- [ ] **Step 3: Update emitBaselinePolicyEvents to include observation**

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

- [ ] **Step 4: Update turn override emission to include observation**

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/orchestrator && pnpm vitest run __tests__/policy-runner.test.ts`
Expected: PASS

- [ ] **Step 6: Run full build to check for any remaining type errors**

Run: `pnpm build && pnpm test`
Expected: PASS (fix any test fixtures that now need observation field)

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/runner.ts packages/orchestrator/__tests__/policy-runner.test.ts
git commit -m "feat(runner): emit full observation payload in policy baseline and override events"
```

---

### Task 3: Track Per-Role RuntimePolicyState in TUI Store

**Files:**
- Modify: `packages/tui/src/state/types.ts`
- Modify: `packages/tui/src/state/tui-store.ts`
- Modify: `packages/tui/__tests__/tui-store.test.ts`

Currently `policy.baseline` is a no-op in TUI store and `policy.turn.override` only sets `executionMode` string. This task replaces that with proper `RuntimePolicyState` tracking.

- [ ] **Step 1: Add policyState to TuiState**

In `packages/tui/src/state/types.ts`, add to `TuiState`:

```ts
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";

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
  policyState: Record<string, RuntimePolicyState>;
}
```

- [ ] **Step 2: Write failing test for policy.baseline tracking**

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

it("tracks RuntimePolicyState from policy.baseline events", () => {
  const store = new TuiStore();
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
  expect(state.policyState.proposer).toBeDefined();
  expect(state.policyState.proposer.baseline.preset.value).toBe("research");
  expect(state.policyState.proposer.baseline.observation.completeness).toBe("partial");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/tui && pnpm vitest run __tests__/tui-store.test.ts`
Expected: FAIL — policyState not defined.

- [ ] **Step 4: Initialize policyState in TuiStore constructor**

In `packages/tui/src/state/tui-store.ts`, update constructor:

```ts
constructor() {
  this.state = {
    proposer: defaultAgentPanel("proposer"),
    challenger: defaultAgentPanel("challenger"),
    rounds: [],
    judgeResults: [],
    judge: defaultJudge(),
    metrics: defaultMetrics(),
    command: defaultCommand(),
    debateState: DEFAULT_DEBATE_STATE,
    policyState: {},
  };
}
```

- [ ] **Step 5: Implement policy event handling in applyEvent()**

In `packages/tui/src/state/tui-store.ts`, replace the existing policy event cases:

```ts
case "policy.baseline": {
  const e = event as PolicyBaselineEvent;
  this.state.policyState[e.role] = {
    baseline: {
      policy: e.policy,
      clamps: [...e.clamps],
      preset: { ...e.preset },
      translationSummary: e.translationSummary,
      warnings: [...e.warnings],
      observation: e.observation,
    },
  };
  break;
}
case "policy.turn.override": {
  const e = event as PolicyTurnOverrideEvent;
  const existing = this.state.policyState[e.role];
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
  // Keep backward-compatible executionMode for now (Task 6 removes it)
  this.state[e.role as "proposer" | "challenger"].executionMode = e.preset;
  break;
}
case "policy.turn.override.clear": {
  const e = event as PolicyTurnOverrideClearEvent;
  // Clear override from all roles that have this turnId
  for (const rps of Object.values(this.state.policyState)) {
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

- [ ] **Step 6: Write tests for override and clear tracking**

```ts
it("tracks policy.turn.override in RuntimePolicyState", () => {
  const store = new TuiStore();
  // First set baseline
  store.handleEvent(ev("policy.baseline", {
    role: "proposer",
    policy: { preset: "research", roleContract: {}, capabilities: {}, interaction: {} },
    clamps: [],
    preset: { value: "research", source: "cli-role" },
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));
  // Then override
  store.handleEvent(ev("policy.turn.override", {
    role: "proposer",
    turnId: "p-1",
    policy: { preset: "dangerous", roleContract: {}, capabilities: {}, interaction: {} },
    preset: "dangerous",
    translationSummary: stubObservation.translation,
    warnings: [],
    observation: stubObservation,
  }));

  const state = store.getState();
  expect(state.policyState.proposer.currentTurnOverride).toBeDefined();
  expect(state.policyState.proposer.currentTurnOverride?.preset).toBe("dangerous");
});

it("clears policy.turn.override on clear event", () => {
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

  const state = store.getState();
  expect(state.policyState.proposer.currentTurnOverride).toBeUndefined();
  expect(state.policyState.proposer.baseline.preset.value).toBe("research");
});
```

- [ ] **Step 7: Run tests**

Run: `cd packages/tui && pnpm vitest run __tests__/tui-store.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/state/types.ts packages/tui/src/state/tui-store.ts packages/tui/__tests__/tui-store.test.ts
git commit -m "feat(tui): track per-role RuntimePolicyState from policy events"
```

---

### Task 4: Create Status View Models

**Files:**
- Create: `packages/tui/src/status/status-view-models.ts`
- Create: `packages/tui/__tests__/status/status-view-models.test.ts`

View models take `RuntimePolicyState` (from orchestrator-core) as input and return structured data for rendering. They do not import TUI store.

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
  it("returns baseline policy summary", () => {
    const view = buildStatusPolicyView("proposer", "claude", makeState());
    expect(view.role).toBe("proposer");
    expect(view.adapter).toBe("claude");
    expect(view.baseline.preset.value).toBe("research");
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
    const view = buildStatusPolicyView("proposer", "claude", state);
    expect(view.override).toBeDefined();
    expect(view.override?.turnId).toBe("p-1");
    expect(view.override?.preset).toBe("dangerous");
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
  state: RuntimePolicyState,
): StatusPolicyView {
  const view: StatusPolicyView = {
    role,
    adapter,
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

### Task 5: Create Status Text Renderers

**Files:**
- Create: `packages/tui/src/status/status-renderers.ts`
- Create: `packages/tui/__tests__/status/status-renderers.test.ts`

These render `StatusPolicyView` and `StatusToolsView` into text strings, following the same patterns as `packages/cli/src/commands/inspection-renderers.ts`.

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
  it("renders baseline policy summary", () => {
    const text = renderStatusPolicy([basePolicyView]);
    expect(text).toContain("proposer");
    expect(text).toContain("claude");
    expect(text).toContain("research");
    expect(text).toContain("cli-role");
    expect(text).toContain("capabilities.shell");
    expect(text).toContain("maxTurns is approximate");
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
import type { StatusPolicyView, StatusToolsView } from "./status-view-models.js";

export function renderStatusPolicy(views: StatusPolicyView[]): string {
  if (views.length === 0) {
    return "Policy state not yet available.";
  }

  const lines: string[] = [];
  for (const view of views) {
    lines.push(`\n=== ${view.role} (${view.adapter}) ===`);
    lines.push(`  Preset: ${view.baseline.preset.value} (${view.baseline.preset.source})`);

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

  const lines: string[] = ["(Best-effort observation — not an execution guarantee)"];
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
        lines.push(`    ${icon} ${t.name} [${t.source}] ${t.status} — ${t.reason}${suffix}`);
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

### Task 6: Add /status Command Parsing and Dispatch

**Files:**
- Modify: `packages/tui/src/components/command-input.tsx`
- Modify: `packages/cli/src/wiring/live-command-handler.ts`
- Modify: `packages/tui/__tests__/command-input.test.tsx`

Add `/status policy` and `/status tools` to the command parsing and dispatch pipeline.

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

In `packages/cli/src/wiring/live-command-handler.ts`, add handling for the status command. The handler needs access to the TUI store's `policyState` and adapter metadata to build view models.

First, update the `LiveCommandHandlerOptions` type to include a `getStatusContext` callback:

```ts
export interface LiveCommandHandlerOptions {
  adapters: AdapterBundle["adapters"];
  bus: DebateEventBus;
  store: TuiStore;
  triggerShutdown: () => void;
  getUserQuitHandler: () => (() => void) | undefined;
}
```

In the command handler function, add the status case:

```ts
case "status": {
  const policyState = store.getState().policyState;
  const roleEntries = Object.entries(policyState);

  if (cmd.target === "policy") {
    const views = roleEntries.map(([role, state]) => {
      const adapter = adapters[role as keyof typeof adapters]?.session?.adapterId ?? "unknown";
      return buildStatusPolicyView(role, adapter, state);
    });
    const text = renderStatusPolicy(views);
    store.pushCommandOutput(text);
  } else {
    const views = roleEntries.map(([role, state]) => {
      const adapter = adapters[role as keyof typeof adapters]?.session?.adapterId ?? "unknown";
      return buildStatusToolsView(role, adapter, state);
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

- [ ] **Step 8: Run build and tests**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/tui/src/components/command-input.tsx packages/cli/src/wiring/live-command-handler.ts packages/tui/src/state/tui-store.ts packages/tui/src/state/types.ts packages/tui/__tests__/command-input.test.tsx
git commit -m "feat(tui): add /status policy and /status tools command parsing and dispatch"
```

---

### Task 7: Replace executionMode Display with Effective Preset

**Files:**
- Modify: `packages/tui/src/components/agent-panel.tsx`
- Modify: `packages/tui/src/render/render-blocks.ts`
- Modify: `packages/tui/src/render/line-buffer.ts`
- Modify: `packages/tui/src/render/tool-status.ts`
- Modify: `packages/tui/src/state/types.ts`
- Modify: `packages/tui/__tests__/tui-store.test.ts`
- Modify: `packages/tui/__tests__/render/render-blocks.test.ts`

Replace the legacy `executionMode` string display with the effective preset derived from `RuntimePolicyState`. The panel header should show the effective preset; full provenance is reserved for `/status policy`.

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

In the `policy.turn.override` case, change:
```ts
this.state[e.role as "proposer" | "challenger"].executionMode = e.preset;
```
to:
```ts
this.state[e.role as "proposer" | "challenger"].preset = e.preset;
```

In `policy.baseline` case, also set initial preset:
```ts
this.state[e.role as "proposer" | "challenger"].preset = e.preset.value;
```

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

- [ ] **Step 9: Commit**

```bash
git add packages/tui/
git commit -m "refactor(tui): replace executionMode display with effective preset from policy state"
```

---

### Task 8: Add Warning Badge to Panel Headers

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

In `packages/tui/src/render/render-blocks.ts`, add `warningCount?: number` to the agent-header block shape. Compute it from TuiState's policyState:

```ts
// In liveStateToBlocks(), look up warning count from policyState
warningCount: policyState?.[state.role]?.baseline?.warnings?.length ?? 0,
```

Note: `liveStateToBlocks` will need access to `policyState`. Check its current signature and add the parameter if needed.

- [ ] **Step 4: Render warning badge in line-buffer**

In `packages/tui/src/render/line-buffer.ts`, after the preset label, append the badge:

```ts
const badge = formatWarningBadge(block.warningCount ?? 0);
// Use in assembled header: `${icon} ${label}${agent}${presetLabel}${badge}`
```

Import `formatWarningBadge` from the status module.

- [ ] **Step 5: Render warning badge in agent-panel.tsx**

In the live mode header, append the badge after the preset suffix. Derive warning count from the store's `policyState` for the current role.

- [ ] **Step 6: Run tests**

Run: `cd packages/tui && pnpm vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tui/
git commit -m "feat(tui): add warning count badge to agent panel headers"
```

---

### Task 9: Update Architecture Docs

**Files:**
- Modify: `docs/architecture/tui-cli.md`
- Modify: `docs/architecture/orchestrator.md`

- [ ] **Step 1: Update TUI-CLI architecture doc**

In `docs/architecture/tui-cli.md`, add documentation for:
- `/status policy` and `/status tools` commands
- RuntimePolicyState tracking in TUI store
- Status view model architecture (decoupled from TUI store)
- Warning badge on panel headers
- Preset display replacing executionMode

- [ ] **Step 2: Update orchestrator architecture doc**

In `docs/architecture/orchestrator.md`, update:
- Policy event emission now includes full `ProviderObservationResult` in baseline and override events
- RuntimePolicyState lifecycle description

- [ ] **Step 3: Run build to verify no issues**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/
git commit -m "docs: update architecture docs for D1 runtime visibility"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| `/status policy` TUI live command | Tasks 5, 6 |
| `/status tools` TUI live command | Tasks 5, 6 |
| Event-derived RuntimePolicyState per-session per-role | Tasks 1, 2, 3 |
| Observation payload in baseline/override events | Tasks 1, 2 |
| View models independent of TUI store | Task 4 |
| Status renderers share patterns with inspect renderers | Task 5 |
| Snapshot-at-invocation semantics | Task 6 (store.getState() is point-in-time) |
| Replace executionMode with effective preset | Task 7 |
| Header shows preset only, provenance reserved for /status | Task 7 |
| Warning badge on panel headers | Task 8 |
| Architecture docs updated | Task 9 |

### Type consistency check

- `RuntimePolicyState` used consistently across Tasks 1, 3, 4, 5
- `ProviderObservationResult` added to events in Task 1, consumed in Tasks 3, 4
- `StatusPolicyView` / `StatusToolsView` defined in Task 4, consumed in Tasks 5, 6
- `ParsedCommand` extended in Task 6, handled in Task 6
- `preset` replaces `executionMode` in Task 7 across all TUI types and renderers
