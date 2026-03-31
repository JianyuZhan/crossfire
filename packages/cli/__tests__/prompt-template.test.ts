import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
	inferPromptTemplateFamily,
	loadPromptTemplate,
	resolvePromptTemplateFamily,
	resolveRolePrompt,
	selectPromptTemplateSelection,
} from "../src/profile/prompt-template.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS_DIR = resolve(TEST_DIR, "../../..", "prompts");

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

	it("ships a general challenger template with multi-dimensional challenge guidance", () => {
		const builtInTemplate = loadPromptTemplate("general", "challenger", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain(
			"cover at least four concrete challenge dimensions",
		);
		expect(builtInTemplate).toContain("Channel leakage, bypass risk");
		expect(builtInTemplate).toContain(
			"top 2-3 unanswered questions or missing controls",
		);
	});

	it("ships a code challenger template with implementation-focused challenge guidance", () => {
		const builtInTemplate = loadPromptTemplate("code", "challenger", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain(
			"cover at least four concrete challenge dimensions",
		);
		expect(builtInTemplate).toContain("Behavioral correctness and edge cases");
		expect(builtInTemplate).toContain(
			"top 2-3 unresolved technical questions, missing tests, or rollout blockers",
		);
	});

	it("ships a general judge template that penalizes shallow challenge lists", () => {
		const builtInTemplate = loadPromptTemplate("general", "judge", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain("Proposer Quality Standard");
		expect(builtInTemplate).toContain(
			"translate strategy into concrete mechanisms, controls, and operating steps",
		);
		expect(builtInTemplate).toContain("Challenger Quality Standard");
		expect(builtInTemplate).toContain(
			"Do not reward the challenger merely for listing many risks",
		);
		expect(builtInTemplate).toContain("Convergence Standard");
	});

	it("ships a code judge template that requires concrete technical challenge evidence", () => {
		const builtInTemplate = loadPromptTemplate("code", "judge", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain("Proposer Quality Standard");
		expect(builtInTemplate).toContain(
			"describe the concrete implementation path, affected interfaces, and rollout shape",
		);
		expect(builtInTemplate).toContain("Challenger Quality Standard");
		expect(builtInTemplate).toContain(
			"cite the relevant file paths, symbols, commands, or lines",
		);
		expect(builtInTemplate).toContain("Convergence Standard");
	});

	it("ships a general proposer template with phased operational planning guidance", () => {
		const builtInTemplate = loadPromptTemplate("general", "proposer", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain("Proposal Standard");
		expect(builtInTemplate).toContain(
			"Target customer, positioning, and trust-building mechanics",
		);
		expect(builtInTemplate).toContain(
			"Make the plan specific enough that a human operator could execute the first phase",
		);
	});

	it("ships a code proposer template with implementation and rollout guidance", () => {
		const builtInTemplate = loadPromptTemplate("code", "proposer", [
			REPO_PROMPTS_DIR,
		]);
		expect(builtInTemplate).toContain("Proposal Standard");
		expect(builtInTemplate).toContain("Behavioral correctness and edge cases");
		expect(builtInTemplate).toContain(
			"Make the next coding, testing, and rollout steps explicit",
		);
	});
});
