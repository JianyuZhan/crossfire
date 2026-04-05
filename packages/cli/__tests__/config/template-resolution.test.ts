import { describe, expect, it } from "vitest";
import type { PolicyTemplateConfig } from "../../src/config/schema.js";
import { resolveTemplate } from "../../src/config/template-resolution.js";

const TEMPLATES: PolicyTemplateConfig[] = [
	{
		name: "strict",
		basePreset: "guarded",
		overrides: { evidence: { bar: "high" } },
	},
	{ name: "relaxed", basePreset: "research" },
	{ name: "ev-only", overrides: { evidence: { bar: "low" } } },
];

describe("resolveTemplate", () => {
	it("returns matching template by name", () => {
		const result = resolveTemplate("strict", TEMPLATES);
		expect(result).toEqual(TEMPLATES[0]);
	});

	it("returns undefined for unknown template name", () => {
		const result = resolveTemplate("nonexistent", TEMPLATES);
		expect(result).toBeUndefined();
	});

	it("returns template with no basePreset", () => {
		const result = resolveTemplate("ev-only", TEMPLATES);
		expect(result).toBeDefined();
		expect(result?.basePreset).toBeUndefined();
	});
});
