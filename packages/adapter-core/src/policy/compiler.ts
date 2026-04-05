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

const CAPABILITY_CLAMPS = [
	{ key: "filesystem", clamp: clampFilesystem },
	{ key: "network", clamp: clampNetwork },
	{ key: "shell", clamp: clampShell },
	{ key: "subagents", clamp: clampSubagents },
] as const;

function clampCapabilitiesWithNotes(
	base: CapabilityPolicy,
	ceilings: CapabilityCeilings,
): {
	capabilities: CapabilityPolicy;
	clamps: PolicyClampNote[];
} {
	const clamps: PolicyClampNote[] = [];
	const result = {} as Record<string, string>;

	for (const { key, clamp } of CAPABILITY_CLAMPS) {
		const clamped = clamp(base[key] as never, ceilings[key] as never);
		result[key] = clamped;
		if (clamped !== base[key]) {
			clamps.push({
				field: `capabilities.${key}` as PolicyClampNote["field"],
				before: base[key],
				after: clamped,
				reason: "role_ceiling",
			});
		}
	}

	return { capabilities: result as unknown as CapabilityPolicy, clamps };
}

function compilePolicyInternal(
	input: CompilePolicyInput,
): CompilePolicyDiagnostics {
	const { preset, role, evidenceOverride, interactionOverride } = input;

	const presetExpansion = PRESET_EXPANSIONS[preset];
	const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

	const { capabilities, clamps } = clampCapabilitiesWithNotes(
		presetExpansion.capabilities,
		roleContract.ceilings,
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
