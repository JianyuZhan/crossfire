import { compilePolicy } from "@crossfire/adapter-core";
import { describe, expect, it } from "vitest";
import type { RoleInspectionContext } from "../../src/commands/inspection-context.js";
import { renderPolicyText } from "../../src/commands/inspection-renderers.js";

function makeInspectionContext(
	overrides: Partial<RoleInspectionContext> = {},
): RoleInspectionContext {
	const policy = compilePolicy({ preset: "guarded", role: "proposer" });
	return {
		role: "proposer",
		adapter: "claude",
		model: "test-model",
		preset: { value: "guarded", source: "config" },
		resolvedPolicy: policy,
		clamps: [],
		observation: {
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
			completeness: "full",
		},
		...overrides,
	} as RoleInspectionContext;
}

describe("renderPolicyText", () => {
	it("includes evidence section with bar and source", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: "high", source: "config" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("bar: high");
		expect(output).toContain("(config)");
	});

	it("shows role-default evidence when no explicit override", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: "medium", source: "role-default" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("bar: medium");
		expect(output).toContain("(role-default)");
	});

	it("shows template evidence source", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: "low", source: "template:strict" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("template:strict");
	});

	it("shows template provenance with name and basePreset", () => {
		const ctx = makeInspectionContext({
			template: { name: "strict", basePreset: "guarded" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Template: strict");
		expect(output).toContain("basePreset: guarded");
	});

	it("shows template provenance without basePreset when absent", () => {
		const ctx = makeInspectionContext({
			template: { name: "ev-only" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Template: ev-only");
		expect(output).not.toContain("basePreset");
	});

	it("omits template line when no template used", () => {
		const ctx = makeInspectionContext();
		const output = renderPolicyText([ctx]);
		expect(output).not.toContain("Template:");
	});
});
