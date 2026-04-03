import type {
	CapabilityPolicy,
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import type { ClaudePermissionMode } from "./types.js";

export interface ClaudeNativeOptions {
	permissionMode: ClaudePermissionMode;
	maxTurns?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowDangerouslySkipPermissions?: boolean;
}

const CLAUDE_SHELL_TOOLS = ["Bash"];
const CLAUDE_FILESYSTEM_ALL_TOOLS = [
	"Read",
	"Edit",
	"Write",
	"Glob",
	"Grep",
	"LS",
];
const CLAUDE_FILESYSTEM_WRITE_TOOLS = ["Edit", "Write"];
const CLAUDE_NETWORK_TOOLS = ["WebFetch"];
export const CLAUDE_SUBAGENT_TOOLS = ["Task"];

function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

function translateApproval(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): {
	permissionMode: ClaudePermissionMode;
	allowDangerouslySkipPermissions?: boolean;
} {
	if (isPlanShape(policy)) return { permissionMode: "plan" };
	switch (policy.interaction.approval) {
		case "never":
			return {
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
			};
		case "on-risk":
			return { permissionMode: "default" };
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no per-tool-must-approve mode; mapped to default",
			});
			return { permissionMode: "default" };
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no on-failure approval; mapped to default",
			});
			return { permissionMode: "default" };
	}
}

function computeBaseDenyList(capabilities: CapabilityPolicy): string[] {
	const deny: string[] = [];
	if (capabilities.shell === "off") deny.push(...CLAUDE_SHELL_TOOLS);
	if (capabilities.filesystem === "off")
		deny.push(...CLAUDE_FILESYSTEM_ALL_TOOLS);
	else if (capabilities.filesystem === "read")
		deny.push(...CLAUDE_FILESYSTEM_WRITE_TOOLS);
	if (capabilities.network === "off") deny.push(...CLAUDE_NETWORK_TOOLS);
	if (capabilities.subagents === "off") deny.push(...CLAUDE_SUBAGENT_TOOLS);
	return deny;
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

function warnUnsupportedLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
	if (limits.maxToolCalls !== undefined)
		warnings.push({
			field: "interaction.limits.maxToolCalls",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support maxToolCalls limit",
		});
	if (limits.timeoutMs !== undefined)
		warnings.push({
			field: "interaction.limits.timeoutMs",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support timeoutMs limit",
		});
	if (limits.budgetUsd !== undefined)
		warnings.push({
			field: "interaction.limits.budgetUsd",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support budgetUsd limit",
		});
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<ClaudeNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];
	const { permissionMode, allowDangerouslySkipPermissions } = translateApproval(
		policy,
		warnings,
	);
	const toolPolicy = buildToolPolicy(policy.capabilities, warnings);
	const maxTurns = policy.interaction.limits?.maxTurns;
	warnUnsupportedLimits(policy.interaction.limits, warnings);
	return {
		native: {
			permissionMode,
			maxTurns,
			...toolPolicy,
			...(allowDangerouslySkipPermissions
				? { allowDangerouslySkipPermissions }
				: {}),
		},
		warnings,
	};
}
