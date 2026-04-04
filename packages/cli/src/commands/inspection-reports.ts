import type {
	CapabilityEffectRecord,
	PolicyClampNote,
	PolicyPreset,
	PolicyTranslationSummary,
	PolicyTranslationWarning,
	PresetSource,
	ResolvedPolicy,
	ToolInspectionRecord,
} from "@crossfire/adapter-core";
import type { RoleInspectionContext } from "./inspection-context.js";

interface PresetSelection {
	value: PolicyPreset;
	source: PresetSource;
}

interface InspectionError {
	message: string;
}

export interface RolePolicyInspection {
	role: "proposer" | "challenger" | "judge";
	adapter: string;
	model?: string;
	preset: PresetSelection;
	resolvedPolicy?: ResolvedPolicy;
	clamps?: readonly PolicyClampNote[];
	translation?: PolicyTranslationSummary;
	warnings?: readonly PolicyTranslationWarning[];
	error?: InspectionError;
}

export interface PolicyInspectionReport {
	roles: RolePolicyInspection[];
}

export interface RoleToolInspection {
	role: "proposer" | "challenger" | "judge";
	adapter: string;
	model?: string;
	preset: PresetSelection;
	tools: readonly ToolInspectionRecord[];
	capabilityEffects: readonly CapabilityEffectRecord[];
	completeness: "full" | "partial" | "minimal";
	warnings: readonly PolicyTranslationWarning[];
	error?: InspectionError;
}

export interface ToolInspectionReport {
	roles: RoleToolInspection[];
}

export function buildPolicyInspectionReport(
	contexts: RoleInspectionContext[],
): PolicyInspectionReport {
	return {
		roles: contexts.map((ctx) => {
			if (ctx.error) {
				return {
					role: ctx.role,
					adapter: ctx.adapter,
					model: ctx.model,
					preset: ctx.preset,
					error: ctx.error,
				};
			}
			return {
				role: ctx.role,
				adapter: ctx.adapter,
				model: ctx.model,
				preset: ctx.preset,
				resolvedPolicy: ctx.resolvedPolicy,
				clamps: ctx.clamps,
				translation: ctx.observation.translation,
				warnings: ctx.observation.warnings,
			};
		}),
	};
}

export function buildToolInspectionReport(
	contexts: RoleInspectionContext[],
): ToolInspectionReport {
	return {
		roles: contexts.map((ctx) => {
			if (ctx.error) {
				return {
					role: ctx.role,
					adapter: ctx.adapter,
					model: ctx.model,
					preset: ctx.preset,
					tools: [],
					capabilityEffects: [],
					completeness: "minimal" as const,
					warnings: [],
					error: ctx.error,
				};
			}
			return {
				role: ctx.role,
				adapter: ctx.adapter,
				model: ctx.model,
				preset: ctx.preset,
				tools: ctx.observation.toolView,
				capabilityEffects: ctx.observation.capabilityEffects,
				completeness: ctx.observation.completeness,
				warnings: ctx.observation.warnings,
			};
		}),
	};
}
