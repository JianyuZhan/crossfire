import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import type {
	PolicyBaselineEvent,
	PolicyTurnOverrideClearEvent,
	PolicyTurnOverrideEvent,
	RuntimePolicyState,
} from "../src/orchestrator-events.js";

function reconstructState(
	events: Array<
		PolicyBaselineEvent | PolicyTurnOverrideEvent | PolicyTurnOverrideClearEvent
	>,
): RuntimePolicyState | undefined {
	let state: RuntimePolicyState | undefined;
	for (const e of events) {
		if (e.kind === "policy.baseline") {
			state = {
				baseline: {
					policy: e.policy,
					clamps: e.clamps,
					preset: e.preset,
					translationSummary: e.translationSummary,
					warnings: e.warnings,
				},
			};
		} else if (e.kind === "policy.turn.override" && state) {
			state = {
				...state,
				currentTurnOverride: {
					turnId: e.turnId,
					policy: e.policy,
					preset: e.preset,
					translationSummary: e.translationSummary,
					warnings: e.warnings,
				},
			};
		} else if (e.kind === "policy.turn.override.clear" && state) {
			state = { ...state, currentTurnOverride: undefined };
		}
	}
	return state;
}

describe("event-derived RuntimePolicyState", () => {
	const emptyTranslationSummary = {
		adapter: "claude",
		nativeSummary: {},
		exactFields: [],
		approximateFields: [],
		unsupportedFields: [],
	};

	it("reconstructs baseline from single event", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const events: PolicyBaselineEvent[] = [
			{
				kind: "policy.baseline",
				role: "proposer",
				policy,
				clamps: [],
				preset: { value: "guarded", source: "config" },
				translationSummary: emptyTranslationSummary,
				warnings: [],
				timestamp: Date.now(),
			},
		];
		const state = reconstructState(events);
		expect(state).toBeDefined();
		expect(state?.baseline.policy).toEqual(policy);
		expect(state?.currentTurnOverride).toBeUndefined();
	});

	it("turn override does not overwrite baseline", () => {
		const baselinePolicy = makeResolvedPolicy({
			preset: "guarded",
			role: "proposer",
		});
		const overridePolicy = makeResolvedPolicy({
			preset: "dangerous",
			role: "proposer",
		});
		const events = [
			{
				kind: "policy.baseline" as const,
				role: "proposer" as const,
				policy: baselinePolicy,
				clamps: [],
				preset: { value: "guarded" as const, source: "config" as const },
				translationSummary: emptyTranslationSummary,
				warnings: [],
				timestamp: Date.now(),
			},
			{
				kind: "policy.turn.override" as const,
				role: "proposer" as const,
				turnId: "turn-1",
				policy: overridePolicy,
				preset: "dangerous" as const,
				translationSummary: emptyTranslationSummary,
				warnings: [],
				timestamp: Date.now(),
			},
		];
		const state = reconstructState(events);
		expect(state).toBeDefined();
		expect(state?.baseline.policy).toEqual(baselinePolicy);
		expect(state?.currentTurnOverride?.policy).toEqual(overridePolicy);
		expect(state?.currentTurnOverride?.turnId).toBe("turn-1");
	});

	it("turn override clear removes current override", () => {
		const baselinePolicy = makeResolvedPolicy({
			preset: "guarded",
			role: "proposer",
		});
		const overridePolicy = makeResolvedPolicy({
			preset: "dangerous",
			role: "proposer",
		});
		const events = [
			{
				kind: "policy.baseline" as const,
				role: "proposer" as const,
				policy: baselinePolicy,
				clamps: [],
				preset: { value: "guarded" as const, source: "config" as const },
				translationSummary: emptyTranslationSummary,
				warnings: [],
				timestamp: Date.now(),
			},
			{
				kind: "policy.turn.override" as const,
				role: "proposer" as const,
				turnId: "turn-1",
				policy: overridePolicy,
				preset: "dangerous" as const,
				translationSummary: emptyTranslationSummary,
				warnings: [],
				timestamp: Date.now(),
			},
			{
				kind: "policy.turn.override.clear" as const,
				turnId: "turn-1",
				timestamp: Date.now(),
			},
		];
		const state = reconstructState(events);
		expect(state).toBeDefined();
		expect(state?.baseline.policy).toEqual(baselinePolicy);
		expect(state?.currentTurnOverride).toBeUndefined();
	});
});
