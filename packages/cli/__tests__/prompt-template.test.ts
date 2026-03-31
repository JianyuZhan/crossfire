import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	inferPromptTemplateFamily,
	loadPromptTemplate,
	resolvePromptTemplateFamily,
	resolveRolePrompt,
	selectPromptTemplateSelection,
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
		expect(resolvePromptTemplateFamily("code", "general")).toBe("code");
	});

	it("falls back to the classifier family when selection is auto", () => {
		expect(resolvePromptTemplateFamily("auto", "code")).toBe("code");
	});
});

describe("selectPromptTemplateSelection", () => {
	it("prefers explicit per-role selection", () => {
		expect(
			selectPromptTemplateSelection({
				profile: {
					name: "claude_proposer",
					agent: "claude_code",
					prompt_family: "general",
					inherit_global_config: true,
					mcp_servers: {},
					filePath: "/tmp/profile.json",
				},
				explicitSelection: "code",
				inheritedSelection: "general",
			}),
		).toBe("code");
	});

	it("falls back to profile default and then inherited selection", () => {
		expect(
			selectPromptTemplateSelection({
				profile: {
					name: "claude_proposer",
					agent: "claude_code",
					prompt_family: "general",
					inherit_global_config: true,
					mcp_servers: {},
					filePath: "/tmp/profile.json",
				},
			}),
		).toBe("general");
		expect(
			selectPromptTemplateSelection({
				profile: {
					name: "claude_proposer",
					agent: "claude_code",
					inherit_global_config: true,
					mcp_servers: {},
					filePath: "/tmp/profile.json",
				},
				inheritedSelection: "code",
			}),
		).toBe("code");
	});
});

describe("loadPromptTemplate", () => {
	let promptsDir: string;

	beforeEach(() => {
		promptsDir = mkdtempSync(join(tmpdir(), "crossfire-prompts-"));
		mkdirSync(join(promptsDir, "general"), { recursive: true });
	});

	it("loads a role template from prompts/<family>/<role>.md", () => {
		writeFileSync(
			join(promptsDir, "general", "challenger.md"),
			"Challenge the plan with market evidence.\n",
		);
		expect(loadPromptTemplate("general", "challenger", [promptsDir])).toBe(
			"Challenge the plan with market evidence.",
		);
	});

	it("throws a helpful error when the template is missing", () => {
		expect(() => loadPromptTemplate("code", "judge", [promptsDir])).toThrow(
			/Prompt template "code\/judge" not found/i,
		);
	});

	it("resolves a role prompt from a chosen family", () => {
		writeFileSync(
			join(promptsDir, "general", "proposer.md"),
			"Build the plan.\n",
		);
		expect(
			resolveRolePrompt({
				role: "proposer",
				family: "general",
				searchPaths: [promptsDir],
			}),
		).toEqual({
			systemPrompt: "Build the plan.",
			promptTemplateFamily: "general",
			promptTemplateSource: "template",
		});
	});
});
