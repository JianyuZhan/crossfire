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
