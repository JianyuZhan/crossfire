// packages/adapter-claude/src/policy-observation.ts
import type {
	CapabilityEffectRecord,
	CapabilityPolicy,
	ObservationCompleteness,
	PolicyTranslationSummary,
	PolicyTranslationWarning,
	ProviderObservationResult,
	ResolvedPolicy,
	ToolInspectionRecord,
} from "@crossfire/adapter-core";
import type { ClaudePermissionMode } from "./types.js";

// --- Shared constants (also used by policy-translation.ts) ---

export const CLAUDE_SHELL_TOOLS = ["Bash"];
export const CLAUDE_FILESYSTEM_ALL_TOOLS = [
	"Read",
	"Edit",
	"Write",
	"Glob",
	"Grep",
	"LS",
];
export const CLAUDE_FILESYSTEM_WRITE_TOOLS = ["Edit", "Write"];
export const CLAUDE_NETWORK_TOOLS = ["WebFetch"];
export const CLAUDE_SUBAGENT_TOOLS = ["Task"];

export const CLAUDE_ALL_KNOWN_TOOLS = [
	...CLAUDE_SHELL_TOOLS,
	...CLAUDE_FILESYSTEM_ALL_TOOLS,
	...CLAUDE_NETWORK_TOOLS,
	...CLAUDE_SUBAGENT_TOOLS,
];

// --- Shared rule helpers ---

export function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

export interface ApprovalResolution {
	permissionMode: ClaudePermissionMode;
	allowDangerouslySkipPermissions?: boolean;
	warnings: PolicyTranslationWarning[];
}

export function resolveApproval(policy: ResolvedPolicy): ApprovalResolution {
	const warnings: PolicyTranslationWarning[] = [];
	if (isPlanShape(policy)) {
		return { permissionMode: "plan", warnings };
	}
	switch (policy.interaction.approval) {
		case "never":
			return {
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				warnings,
			};
		case "on-risk":
			return { permissionMode: "default", warnings };
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no per-tool-must-approve mode; mapped to default",
			});
			return { permissionMode: "default", warnings };
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no on-failure approval; mapped to default",
			});
			return { permissionMode: "default", warnings };
	}
}

export function computeBaseDenyList(capabilities: CapabilityPolicy): string[] {
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

export interface ClaudeToolPolicyResolution {
	allowedTools?: string[];
	disallowedTools?: string[];
	warnings: PolicyTranslationWarning[];
}

export function resolveToolPolicy(
	capabilities: CapabilityPolicy,
): ClaudeToolPolicyResolution {
	const baseDeny = computeBaseDenyList(capabilities);
	if (!capabilities.legacyToolOverrides) {
		return {
			...(baseDeny.length > 0 ? { disallowedTools: baseDeny } : {}),
			warnings: [],
		};
	}

	const warnings: PolicyTranslationWarning[] = [];
	const { allow, deny } = capabilities.legacyToolOverrides;
	const explicitDeny = new Set(deny ?? []);
	const conflicting = allow?.filter((tool) => baseDeny.includes(tool));
	if (conflicting?.length) {
		warnings.push({
			field: "capabilities.legacyToolOverrides.allow",
			adapter: "claude",
			reason: "approximate",
			message: `Tools [${conflicting.join(", ")}] blocked by capability enum, legacy allow ignored`,
		});
	}
	const effectiveAllow = allow?.filter(
		(tool) => !baseDeny.includes(tool) && !explicitDeny.has(tool),
	);
	const effectiveDeny = [...baseDeny, ...explicitDeny];

	return {
		...(effectiveAllow?.length ? { allowedTools: effectiveAllow } : {}),
		...(effectiveDeny.length ? { disallowedTools: effectiveDeny } : {}),
		warnings,
	};
}

export function resolveCapabilityEffects(
	policy: ResolvedPolicy,
): CapabilityEffectRecord[] {
	const effects: CapabilityEffectRecord[] = [];
	effects.push({
		field: "capabilities.filesystem",
		status: "applied",
		details: `filesystem=${policy.capabilities.filesystem}`,
	});
	effects.push({
		field: "capabilities.shell",
		status: "applied",
		details: `shell=${policy.capabilities.shell}`,
	});
	effects.push({
		field: "capabilities.network",
		status: "applied",
		details: `network=${policy.capabilities.network}`,
	});
	effects.push({
		field: "capabilities.subagents",
		status: "applied",
		details: `subagents=${policy.capabilities.subagents}`,
	});
	return effects;
}

export function resolveToolView(policy: ResolvedPolicy): {
	toolView: ToolInspectionRecord[];
	warnings: PolicyTranslationWarning[];
} {
	const toolPolicy = resolveToolPolicy(policy.capabilities);
	const denyList = new Set(toolPolicy.disallowedTools ?? []);
	const allowList = toolPolicy.allowedTools
		? new Set(toolPolicy.allowedTools)
		: undefined;
	const legacyDeny = new Set(
		policy.capabilities.legacyToolOverrides?.deny ?? [],
	);

	return {
		toolView: CLAUDE_ALL_KNOWN_TOOLS.map((name): ToolInspectionRecord => {
			const blockedByCapability = denyList.has(name) && !legacyDeny.has(name);
			const blockedByLegacyDeny = legacyDeny.has(name);
			const blockedByLegacyAllow =
				allowList !== undefined && !allowList.has(name) && !blockedByCapability;
			const blocked =
				blockedByCapability || blockedByLegacyDeny || blockedByLegacyAllow;
			return {
				name,
				source: "builtin",
				status: blocked ? "blocked" : "allowed",
				reason: blocked
					? blockedByCapability
						? "capability_policy"
						: "legacy_override"
					: allowList?.has(name)
						? "legacy_override"
						: "adapter_default",
				...(blockedByCapability
					? { capabilityField: inferCapabilityField(name) }
					: {}),
				...(blockedByLegacyAllow
					? {
							details:
								"Blocked because it is not included in the legacy allow list",
						}
					: blockedByLegacyDeny
						? { details: "Blocked by legacy deny list" }
						: allowList?.has(name)
							? { details: "Explicitly allowed by legacy allow list" }
							: {}),
			};
		}),
		warnings: toolPolicy.warnings,
	};
}

function inferCapabilityField(toolName: string): string {
	if (CLAUDE_SHELL_TOOLS.includes(toolName)) return "capabilities.shell";
	if (
		CLAUDE_FILESYSTEM_ALL_TOOLS.includes(toolName) ||
		CLAUDE_FILESYSTEM_WRITE_TOOLS.includes(toolName)
	)
		return "capabilities.filesystem";
	if (CLAUDE_NETWORK_TOOLS.includes(toolName)) return "capabilities.network";
	if (CLAUDE_SUBAGENT_TOOLS.includes(toolName)) return "capabilities.subagents";
	return "unknown";
}

export function classifyCompleteness(): ObservationCompleteness {
	return "partial";
}

export function buildLimitsWarnings(
	limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
	const warnings: PolicyTranslationWarning[] = [];
	if (!limits) return warnings;
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
	return warnings;
}

// --- inspectPolicy (Layer 3) ---

export function inspectPolicy(
	policy: ResolvedPolicy,
): ProviderObservationResult {
	const approval = resolveApproval(policy);
	const capabilityEffects = resolveCapabilityEffects(policy);
	const toolResolution = resolveToolView(policy);
	const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

	const allWarnings = [
		...approval.warnings,
		...toolResolution.warnings,
		...limitsWarnings,
	];

	const translation: PolicyTranslationSummary = {
		adapter: "claude",
		nativeSummary: {
			permissionMode: approval.permissionMode,
			maxTurns: policy.interaction.limits?.maxTurns,
		},
		exactFields: allWarnings.length === 0 ? ["interaction.approval"] : [],
		approximateFields: allWarnings
			.filter((w) => w.reason === "approximate")
			.map((w) => w.field),
		unsupportedFields: allWarnings
			.filter((w) => w.reason === "not_implemented")
			.map((w) => w.field),
	};

	return {
		translation,
		toolView: toolResolution.toolView,
		capabilityEffects,
		warnings: allWarnings,
		completeness: classifyCompleteness(),
	};
}
