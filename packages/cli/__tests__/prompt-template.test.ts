import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	inferPromptTemplateFamily,
	loadPromptTemplate,
	resolvePromptTemplateFamily,
} from "../src/profile/prompt-template.js";

describe("inferPromptTemplateFamily", () => {
	it("infers general for business and go-to-market topics", () => {
		expect(
			inferPromptTemplateFamily(
				"Design a B2B SaaS website and SEO growth plan for selling API access",
			),
		).toBe("general");
	});

	it("infers code for repository and implementation topics", () => {
		expect(
			inferPromptTemplateFamily(
				"Review this repository and propose a refactor for the data layer tests",
			),
		).toBe("code");
	});
});

describe("resolvePromptTemplateFamily", () => {
	it("honors an explicit manual selection", () => {
		expect(
			resolvePromptTemplateFamily("code", "A general business topic"),
		).toBe("code");
	});

	it("falls back to inference when selection is auto", () => {
		expect(
			resolvePromptTemplateFamily(
				"auto",
				"Fix the failing TypeScript build in this repository",
			),
		).toBe("code");
	});
});

describe("loadPromptTemplate", () => {
	let profilesDir: string;

	beforeEach(() => {
		profilesDir = mkdtempSync(join(tmpdir(), "crossfire-templates-"));
		mkdirSync(join(profilesDir, "templates", "general"), { recursive: true });
	});

	it("loads a role template from templates/<family>/<role>.md", () => {
		writeFileSync(
			join(profilesDir, "templates", "general", "challenger.md"),
			"Challenge the plan with market evidence.\n",
		);
		expect(loadPromptTemplate("general", "challenger", [profilesDir])).toBe(
			"Challenge the plan with market evidence.",
		);
	});

	it("throws a helpful error when the template is missing", () => {
		expect(() => loadPromptTemplate("code", "judge", [profilesDir])).toThrow(
			/Prompt template "code\/judge" not found/i,
		);
	});
});
