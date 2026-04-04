// packages/cli/src/commands/inspection-context.ts
import {
	type PolicyClampNote,
	type PolicyPreset,
	type ProviderObservationResult,
	type ResolvedPolicy,
	compilePolicyWithDiagnostics,
} from "@crossfire/adapter-core";
import type { PresetSource } from "../config/policy-resolution.js";
import {
	type CliPresetOverrides,
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

		try {
			const diagnostics = compilePolicyWithDiagnostics({
				preset: resolved.preset.value,
				role: roleName,
			});

			const observation = observePolicyForAdapter(
				resolved.adapter,
				diagnostics.policy,
				resolved.mcpServers,
			);

			results.push({
				role: roleName,
				adapter: resolved.adapter,
				model: resolved.model,
				preset: resolved.preset,
				resolvedPolicy: diagnostics.policy,
				clamps: diagnostics.clamps,
				observation,
			});
		} catch (err) {
			results.push({
				role: roleName,
				adapter: resolved.adapter,
				model: resolved.model,
				preset: resolved.preset,
				error: {
					message: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	return results;
}
