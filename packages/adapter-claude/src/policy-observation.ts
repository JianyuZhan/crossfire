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
	return {
		...(baseDeny.length > 0 ? { disallowedTools: baseDeny } : {}),
		warnings: [],
	};
}

const CAPABILITY_DIMENSIONS = [
	"filesystem",
	"shell",
	"network",
	"subagents",
] as const;

export function resolveCapabilityEffects(
	policy: ResolvedPolicy,
): CapabilityEffectRecord[] {
	return CAPABILITY_DIMENSIONS.map((dim) => ({
		field: `capabilities.${dim}`,
		status: "applied" as const,
		details: `${dim}=${policy.capabilities[dim]}`,
	}));
}

export function resolveToolView(policy: ResolvedPolicy): {
	toolView: ToolInspectionRecord[];
	warnings: PolicyTranslationWarning[];
} {
	const toolPolicy = resolveToolPolicy(policy.capabilities);
	const denyList = new Set(toolPolicy.disallowedTools ?? []);

	return {
		toolView: CLAUDE_ALL_KNOWN_TOOLS.map((name): ToolInspectionRecord => {
			const blocked = denyList.has(name);
			return {
				name,
				source: "builtin",
				status: blocked ? "blocked" : "allowed",
				reason: blocked ? "capability_policy" : "adapter_default",
				...(blocked ? { capabilityField: inferCapabilityField(name) } : {}),
			};
		}),
		warnings: toolPolicy.warnings,
	};
}

function inferCapabilityField(toolName: string): string {
	if (CLAUDE_SHELL_TOOLS.includes(toolName)) return "capabilities.shell";
	if (CLAUDE_FILESYSTEM_ALL_TOOLS.includes(toolName))
		return "capabilities.filesystem";
	if (CLAUDE_NETWORK_TOOLS.includes(toolName)) return "capabilities.network";
	if (CLAUDE_SUBAGENT_TOOLS.includes(toolName)) return "capabilities.subagents";
	return "unknown";
}

export function classifyCompleteness(): ObservationCompleteness {
	return "partial";
}

const UNSUPPORTED_LIMITS = ["maxToolCalls", "timeoutMs", "budgetUsd"] as const;

export function buildLimitsWarnings(
	limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
	if (!limits) return [];
	return UNSUPPORTED_LIMITS.filter((key) => limits[key] !== undefined).map(
		(key) => ({
			field: `interaction.limits.${key}`,
			adapter: "claude" as const,
			reason: "not_implemented" as const,
			message: `Claude does not support ${key} limit`,
		}),
	);
}

// --- inspectPolicy (Layer 3) ---

export function inspectPolicy(
	policy: ResolvedPolicy,
): ProviderObservationResult {
	const approval = resolveApproval(policy);
	const capabilityEffects = resolveCapabilityEffects(policy);
	const toolResolution = resolveToolView(policy);
	const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

	const evidenceWarnings: PolicyTranslationWarning[] = [];
	if (policy.evidence) {
		evidenceWarnings.push({
			field: "evidence.bar",
			adapter: "claude",
			reason: "approximate",
			message: `Claude cannot natively enforce evidence bar; setting influences prompting only (configured: ${policy.evidence.bar})`,
		});
	}

	const allWarnings = [
		...approval.warnings,
		...toolResolution.warnings,
		...limitsWarnings,
		...evidenceWarnings,
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
