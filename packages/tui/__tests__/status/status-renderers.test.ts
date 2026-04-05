import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import {
	renderStatusPolicy,
	renderStatusTools,
} from "../../src/status/status-renderers.js";
import type {
	StatusPolicyView,
	StatusToolsView,
} from "../../src/status/status-view-models.js";

const basePolicyView: StatusPolicyView = {
	role: "proposer",
	adapter: "claude",
	model: "claude-sonnet-4-20250514",
	baseline: {
		preset: { value: "research", source: "cli-role" },
		policy: makeResolvedPolicy(),
		clamps: [
			{
				field: "capabilities.shell",
				before: "exec",
				after: "off",
				reason: "role_ceiling",
			},
		],
		translationSummary: {
			adapter: "claude",
			nativeSummary: { permissionMode: "default" },
			exactFields: ["approval"],
			approximateFields: [],
			unsupportedFields: [],
		},
		warnings: [
			{
				field: "limits",
				adapter: "claude",
				reason: "approximate",
				message: "maxTurns is approximate",
			},
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
		expect(text).toContain("exactFields: approval");
		expect(text).toContain("approximateFields: (none)");
		expect(text).toContain("unsupportedFields: (none)");
	});

	it("renders resolved policy capabilities summary", () => {
		const text = renderStatusPolicy([basePolicyView]);
		expect(text).toMatch(/capabilities/i);
	});

	it("renders override section when present", () => {
		const viewWithOverride: StatusPolicyView = {
			...basePolicyView,
			override: {
				turnId: "p-1",
				preset: "dangerous",
				policy: makeResolvedPolicy({ preset: "dangerous" }),
				translationSummary: {
					adapter: "claude",
					nativeSummary: { permissionMode: "plan" },
					exactFields: [],
					approximateFields: ["approval"],
					unsupportedFields: ["interaction.limits.maxTurns"],
				},
				warnings: [],
			},
		};
		const text = renderStatusPolicy([viewWithOverride]);
		expect(text).toContain("Override");
		expect(text).toContain("p-1");
		expect(text).toContain("dangerous");
		expect(text).toContain("Override Translation:");
		expect(text).toContain("permissionMode");
		expect(text).toContain("approximateFields: approval");
		expect(text).toContain("unsupportedFields: interaction.limits.maxTurns");
	});

	it("shows not-yet-available when views array is empty", () => {
		const text = renderStatusPolicy([]);
		expect(text).toContain("not yet available");
	});

	it("renders evidence section (always present in D2+)", () => {
		const text = renderStatusPolicy([basePolicyView]);
		expect(text).toContain("Evidence");
		expect(text).toContain("bar");
		expect(text).toContain("medium");
	});

	it("renders custom evidence bar when overridden", () => {
		const policyWithHighEvidence = makeResolvedPolicy({
			preset: "guarded",
			role: "challenger",
		});
		const viewWithHighEvidence: StatusPolicyView = {
			...basePolicyView,
			baseline: {
				...basePolicyView.baseline,
				policy: policyWithHighEvidence,
			},
		};
		const text = renderStatusPolicy([viewWithHighEvidence]);
		expect(text).toContain("Evidence");
		expect(text).toContain("bar");
		expect(text).toContain("high");
	});
});

describe("renderStatusTools", () => {
	const baseToolsView: StatusToolsView = {
		role: "proposer",
		adapter: "claude",
		source: "baseline",
		toolView: [
			{
				name: "Bash",
				source: "builtin",
				status: "allowed",
				reason: "adapter_default",
			},
			{
				name: "Read",
				source: "builtin",
				status: "blocked",
				reason: "capability_policy",
				capabilityField: "capabilities.shell",
			},
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
