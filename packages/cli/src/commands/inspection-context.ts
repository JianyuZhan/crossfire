// packages/cli/src/commands/inspection-context.ts
import type {
	EvidenceBar,
	EvidenceSource,
	PolicyClampNote,
	PolicyPreset,
	PresetSource,
	ProviderObservationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
	type CliPresetOverrides,
	compilePolicyForRole,
	resolveAllRoles,
} from "../config/resolver.js";
import type { CrossfireConfig } from "../config/schema.js";
import { observePolicyForAdapter } from "../wiring/policy-observation.js";

interface RoleInspectionBase {
	role: "proposer" | "challenger" | "judge";
	adapter: string;
	model?: string;
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	evidence?: {
		bar: EvidenceBar | undefined;
		source: EvidenceSource;
	};
	template?: {
		name: string;
		basePreset?: string;
	};
}

export interface RoleInspectionSuccess extends RoleInspectionBase {
	resolvedPolicy: ResolvedPolicy;
	clamps: readonly PolicyClampNote[];
	observation: ProviderObservationResult;
	error?: undefined;
}

export interface RoleInspectionFailure extends RoleInspectionBase {
	resolvedPolicy?: undefined;
	clamps?: undefined;
	observation?: undefined;
	error: { message: string };
}

export type RoleInspectionContext =
	| RoleInspectionSuccess
	| RoleInspectionFailure;

export function buildInspectionContext(
	config: CrossfireConfig,
	cliOverrides: CliPresetOverrides,
): RoleInspectionContext[] {
	const roles = resolveAllRoles(config, cliOverrides);
	const results: RoleInspectionContext[] = [];

	for (const roleName of ["proposer", "challenger", "judge"] as const) {
		const resolved = roles[roleName];
		if (!resolved) continue;

		const base: RoleInspectionBase = {
			role: roleName,
			adapter: resolved.adapter,
			model: resolved.model,
			preset: resolved.preset,
			evidence: {
				bar: resolved.evidence.bar,
				source: resolved.evidence.source,
			},
			template: resolved.templateName
				? {
						name: resolved.templateName,
						basePreset: resolved.templateBasePreset,
					}
				: undefined,
		};

		try {
			const diagnostics = compilePolicyForRole(resolved);
			base.evidence = {
				bar: diagnostics.policy.evidence.bar,
				source: resolved.evidence.source,
			};

			const observation = observePolicyForAdapter(
				resolved.adapter,
				diagnostics.policy,
				resolved.mcpServers,
			);

			results.push({
				...base,
				resolvedPolicy: diagnostics.policy,
				clamps: diagnostics.clamps,
				observation,
			});
		} catch (err) {
			results.push({
				...base,
				error: {
					message: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	return results;
}
