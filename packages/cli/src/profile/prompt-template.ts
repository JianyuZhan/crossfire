import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProfileConfig } from "./schema.js";

export type PromptTemplateFamily = "general" | "code";
export type PromptTemplateSelection = PromptTemplateFamily | "auto";
export type PromptTemplateRole = "proposer" | "challenger" | "judge";

export const DEFAULT_PROMPT_SEARCH_PATHS = [
	resolve("prompts"),
	join(
		process.env.HOME ?? process.env.USERPROFILE ?? "~",
		".config",
		"crossfire",
		"prompts",
	),
];

const CODE_TOPIC_PATTERN =
	/\b(code|repo|repository|file|files|bug|fix|implement|implementation|refactor|test|tests|typescript|javascript|python|rust|java|go|react|node|package\.json|tsconfig|readme|agents\.md|docs\/architecture|build|compile|lint|patch|diff|pr|pull request)\b/i;

export interface ResolveRolePromptInput {
	role: PromptTemplateRole;
	topic: string;
	profile: ProfileConfig;
	explicitSelection?: PromptTemplateSelection;
	inheritedSelection?: PromptTemplateSelection;
	searchPaths?: string[];
}

export interface ResolvedRolePrompt {
	systemPrompt: string;
	promptTemplateFamily?: PromptTemplateFamily;
	promptTemplateSource: "template";
}

export function parsePromptTemplateSelection(
	value: string | undefined,
	flagName: string,
): PromptTemplateSelection | undefined {
	if (value === undefined) return undefined;
	if (value === "auto" || value === "general" || value === "code") {
		return value;
	}
	throw new Error(`${flagName} must be one of: auto, general, code`);
}

export function inferPromptTemplateFamily(topic: string): PromptTemplateFamily {
	return CODE_TOPIC_PATTERN.test(topic) ? "code" : "general";
}

export function resolvePromptTemplateFamily(
	selection: PromptTemplateSelection | undefined,
	topic: string,
): PromptTemplateFamily {
	if (selection && selection !== "auto") return selection;
	return inferPromptTemplateFamily(topic);
}

export function loadPromptTemplate(
	family: PromptTemplateFamily,
	role: PromptTemplateRole,
	searchPaths: string[] = DEFAULT_PROMPT_SEARCH_PATHS,
): string {
	for (const baseDir of searchPaths) {
		const filePath = join(baseDir, family, `${role}.md`);
		if (existsSync(filePath)) {
			return readFileSync(filePath, "utf-8").trim();
		}
	}
	throw new Error(
		`Prompt template "${family}/${role}" not found. Searched: ${searchPaths
			.map((dir) => join(dir, family, `${role}.md`))
			.join(", ")}`,
	);
}

export function resolveRolePrompt({
	role,
	topic,
	profile,
	explicitSelection,
	inheritedSelection,
	searchPaths,
}: ResolveRolePromptInput): ResolvedRolePrompt {
	if (explicitSelection) {
		const family = resolvePromptTemplateFamily(explicitSelection, topic);
		return {
			systemPrompt: loadPromptTemplate(family, role, searchPaths),
			promptTemplateFamily: family,
			promptTemplateSource: "template",
		};
	}

	const family = resolvePromptTemplateFamily(
		profile.prompt_family ?? inheritedSelection ?? "auto",
		topic,
	);
	return {
		systemPrompt: loadPromptTemplate(family, role, searchPaths),
		promptTemplateFamily: family,
		promptTemplateSource: "template",
	};
}
