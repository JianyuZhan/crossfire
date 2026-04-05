import {
	clampFilesystem,
	clampNetwork,
	clampShell,
	clampSubagents,
} from "./level-order.js";
import type {
	CompilePolicyDiagnostics,
	PolicyClampNote,
} from "./observation-types.js";
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
		evidenceDefaults: { ...rc.evidenceDefaults },
	};
}

function clampCapabilitiesWithNotes(
	base: Omit<CapabilityPolicy, "legacyToolOverrides">,
	ceilings: CapabilityCeilings,
): {
	capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">;
	clamps: PolicyClampNote[];
} {
	const clamps: PolicyClampNote[] = [];

	const filesystem = clampFilesystem(base.filesystem, ceilings.filesystem);
	if (filesystem !== base.filesystem) {
		clamps.push({
			field: "capabilities.filesystem",
			before: base.filesystem,
			after: filesystem,
			reason: "role_ceiling",
		});
	}

	const network = clampNetwork(base.network, ceilings.network);
	if (network !== base.network) {
		clamps.push({
			field: "capabilities.network",
			before: base.network,
			after: network,
			reason: "role_ceiling",
		});
	}

	const shell = clampShell(base.shell, ceilings.shell);
	if (shell !== base.shell) {
		clamps.push({
			field: "capabilities.shell",
			before: base.shell,
			after: shell,
			reason: "role_ceiling",
		});
	}

	const subagents = clampSubagents(base.subagents, ceilings.subagents);
	if (subagents !== base.subagents) {
		clamps.push({
			field: "capabilities.subagents",
			before: base.subagents,
			after: subagents,
			reason: "role_ceiling",
		});
	}

	return { capabilities: { filesystem, network, shell, subagents }, clamps };
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

function compilePolicyInternal(
	input: CompilePolicyInput,
): CompilePolicyDiagnostics {
	const {
		preset,
		role,
		legacyToolPolicy,
		evidenceOverride,
		interactionOverride,
	} = input;

	const presetExpansion = PRESET_EXPANSIONS[preset];
	const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

	const { capabilities: clampedCapabilities, clamps } =
		clampCapabilitiesWithNotes(
			presetExpansion.capabilities,
			roleContract.ceilings,
		);

	const capabilities = applyLegacyToolOverrides(
		clampedCapabilities,
		legacyToolPolicy,
	);

	const evidence = {
		bar: evidenceOverride?.bar ?? roleContract.evidenceDefaults.bar,
	};

	const baseInteraction = presetExpansion.interaction;
	const interaction = interactionOverride
		? {
				approval: interactionOverride.approval ?? baseInteraction.approval,
				...(interactionOverride.limits?.maxTurns !== undefined ||
				baseInteraction.limits
					? {
							limits: {
								...baseInteraction.limits,
								...(interactionOverride.limits?.maxTurns !== undefined
									? { maxTurns: interactionOverride.limits.maxTurns }
									: {}),
							},
						}
					: {}),
			}
		: baseInteraction;

	return {
		policy: {
			preset,
			roleContract,
			capabilities,
			interaction,
			evidence,
		},
		clamps,
	};
}

export function compilePolicy(input: CompilePolicyInput): ResolvedPolicy {
	return compilePolicyInternal(input).policy;
}

export function compilePolicyWithDiagnostics(
	input: CompilePolicyInput,
): CompilePolicyDiagnostics {
	return compilePolicyInternal(input);
}
