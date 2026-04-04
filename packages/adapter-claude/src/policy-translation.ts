// packages/adapter-claude/src/policy-translation.ts
import type {
	CapabilityPolicy,
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
	CLAUDE_SUBAGENT_TOOLS,
	buildLimitsWarnings,
	computeBaseDenyList,
	resolveApproval,
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

function buildToolPolicy(
	capabilities: CapabilityPolicy,
	warnings: PolicyTranslationWarning[],
): { allowedTools?: string[]; disallowedTools?: string[] } {
	const baseDeny = computeBaseDenyList(capabilities);
	if (!capabilities.legacyToolOverrides) {
		return baseDeny.length > 0 ? { disallowedTools: baseDeny } : {};
	}
	const { allow, deny } = capabilities.legacyToolOverrides;
	const conflicting = allow?.filter((tool) => baseDeny.includes(tool));
	if (conflicting?.length) {
		warnings.push({
			field: "capabilities.legacyToolOverrides.allow",
			adapter: "claude",
			reason: "approximate",
			message: `Tools [${conflicting.join(", ")}] blocked by capability enum, legacy allow ignored`,
		});
	}
	const effectiveAllow = allow?.filter((tool) => !baseDeny.includes(tool));
	const effectiveDeny = [...baseDeny, ...(deny ?? [])];
	return {
		...(effectiveAllow?.length ? { allowedTools: effectiveAllow } : {}),
		...(effectiveDeny.length ? { disallowedTools: effectiveDeny } : {}),
	};
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<ClaudeNativeOptions> {
	const approval = resolveApproval(policy);
	const warnings: PolicyTranslationWarning[] = [...approval.warnings];
	const toolPolicy = buildToolPolicy(policy.capabilities, warnings);
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
