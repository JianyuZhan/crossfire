// packages/cli/src/commands/inspection-context.ts
import {
	type EvidenceBar,
	type PolicyClampNote,
	type PolicyPreset,
	type ProviderObservationResult,
	type ResolvedPolicy,
	compilePolicyWithDiagnostics,
} from "@crossfire/adapter-core";
import type { EvidenceSource } from "../config/evidence-resolution.js";
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

		let effectiveEvidenceBar: EvidenceBar | undefined = resolved.evidence.bar;
		try {
			const diagnostics = compilePolicyWithDiagnostics({
				preset: resolved.preset.value,
				role: roleName,
				...(resolved.evidence.bar !== undefined
					? { evidenceOverride: { bar: resolved.evidence.bar } }
					: {}),
				...(resolved.interactionOverrides
					? { interactionOverride: resolved.interactionOverrides }
					: {}),
			});
			effectiveEvidenceBar = diagnostics.policy.evidence.bar;

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
				evidence: {
					bar: effectiveEvidenceBar,
					source: resolved.evidence.source,
				},
				template: resolved.templateName
					? {
							name: resolved.templateName,
							basePreset: resolved.templateBasePreset,
						}
					: undefined,
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
				evidence: {
					bar: effectiveEvidenceBar,
					source: resolved.evidence.source,
				},
				template: resolved.templateName
					? {
							name: resolved.templateName,
							basePreset: resolved.templateBasePreset,
						}
					: undefined,
				error: {
					message: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	return results;
}
