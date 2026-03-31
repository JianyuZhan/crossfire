import type { PromptTemplateFamily } from "./prompt-template.js";
import type { ProfileConfig } from "./schema.js";

export type AdapterType = "claude" | "codex" | "gemini";

export function resolveAdapterType(agent: ProfileConfig["agent"]): AdapterType {
	switch (agent) {
		case "claude_code":
			return "claude";
		case "codex":
			return "codex";
		case "gemini_cli":
			return "gemini";
	}
}

export function resolveModel(
	cliOverride: string | undefined,
	profile: ProfileConfig,
): string | undefined {
	return cliOverride ?? profile.model;
}

export interface RoleInput {
	profile: ProfileConfig;
	cliModel: string | undefined;
	systemPrompt?: string;
	promptTemplateFamily?: PromptTemplateFamily;
}

export interface ResolvedRole {
	profile: ProfileConfig;
	model: string | undefined;
	adapterType: AdapterType;
	systemPrompt: string;
	promptTemplateFamily?: PromptTemplateFamily;
}

export interface ResolvedRoles {
	proposer: ResolvedRole;
	challenger: ResolvedRole;
	judge?: ResolvedRole;
}

export function resolveRoles(input: {
	proposer: RoleInput;
	challenger: RoleInput;
	judge: RoleInput | "none";
}): ResolvedRoles {
	function resolve(role: RoleInput): ResolvedRole {
		return {
			profile: role.profile,
			model: resolveModel(role.cliModel, role.profile),
			adapterType: resolveAdapterType(role.profile.agent),
			systemPrompt: role.systemPrompt ?? role.profile.systemPrompt,
			promptTemplateFamily: role.promptTemplateFamily,
		};
	}

	return {
		proposer: resolve(input.proposer),
		challenger: resolve(input.challenger),
		judge: input.judge === "none" ? undefined : resolve(input.judge),
	};
}
