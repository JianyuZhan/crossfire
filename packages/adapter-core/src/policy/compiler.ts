import {
	clampFilesystem,
	clampNetwork,
	clampShell,
	clampSubagents,
} from "./level-order.js";
import { PRESET_EXPANSIONS } from "./presets.js";
import { DEFAULT_ROLE_CONTRACTS } from "./role-contracts.js";
import type {
	CapabilityCeilings,
	CapabilityPolicy,
	CompilePolicyInput,
	LegacyToolPolicyInput,
	ResolvedPolicy,
	RoleContract,
} from "./types.js";

function copyRoleContract(rc: RoleContract): RoleContract {
	return {
		semantics: { ...rc.semantics },
		ceilings: { ...rc.ceilings },
	};
}

function clampCapabilities(
	base: Omit<CapabilityPolicy, "legacyToolOverrides">,
	ceilings: CapabilityCeilings,
): Omit<CapabilityPolicy, "legacyToolOverrides"> {
	return {
		filesystem: clampFilesystem(base.filesystem, ceilings.filesystem),
		network: clampNetwork(base.network, ceilings.network),
		shell: clampShell(base.shell, ceilings.shell),
		subagents: clampSubagents(base.subagents, ceilings.subagents),
	};
}

function applyLegacyToolOverrides(
	capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">,
	legacyToolPolicy: LegacyToolPolicyInput | undefined,
): CapabilityPolicy {
	if (!legacyToolPolicy) return capabilities;

	const hasAllow =
		legacyToolPolicy.allow !== undefined && legacyToolPolicy.allow.length > 0;
	const hasDeny =
		legacyToolPolicy.deny !== undefined && legacyToolPolicy.deny.length > 0;

	if (!hasAllow && !hasDeny) return capabilities;

	return {
		...capabilities,
		legacyToolOverrides: {
			...(hasAllow ? { allow: legacyToolPolicy.allow } : {}),
			...(hasDeny ? { deny: legacyToolPolicy.deny } : {}),
			source: "legacy-profile" as const,
		},
	};
}

export function compilePolicy(input: CompilePolicyInput): ResolvedPolicy {
	const { preset, role, legacyToolPolicy } = input;

	const presetExpansion = PRESET_EXPANSIONS[preset];
	const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

	const clampedCapabilities = clampCapabilities(
		presetExpansion.capabilities,
		roleContract.ceilings,
	);

	const capabilities = applyLegacyToolOverrides(
		clampedCapabilities,
		legacyToolPolicy,
	);

	return {
		preset,
		roleContract,
		capabilities,
		interaction: presetExpansion.interaction,
	};
}
