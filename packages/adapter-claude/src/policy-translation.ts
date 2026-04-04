// packages/adapter-claude/src/policy-translation.ts
import type {
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
	CLAUDE_SUBAGENT_TOOLS,
	buildLimitsWarnings,
	resolveApproval,
	resolveToolPolicy,
} from "./policy-observation.js";

// Re-export for backward compatibility
export { CLAUDE_SUBAGENT_TOOLS };

export interface ClaudeNativeOptions {
	permissionMode: string;
	maxTurns?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowDangerouslySkipPermissions?: boolean;
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<ClaudeNativeOptions> {
	const approval = resolveApproval(policy);
	const warnings: PolicyTranslationWarning[] = [...approval.warnings];
	const toolPolicy = resolveToolPolicy(policy.capabilities);
	warnings.push(...toolPolicy.warnings);
	const maxTurns = policy.interaction.limits?.maxTurns;
	warnings.push(...buildLimitsWarnings(policy.interaction.limits));
	return {
		native: {
			permissionMode: approval.permissionMode,
			maxTurns,
			...toolPolicy,
			...(approval.allowDangerouslySkipPermissions
				? { allowDangerouslySkipPermissions: true }
				: {}),
		},
		warnings,
	};
}
