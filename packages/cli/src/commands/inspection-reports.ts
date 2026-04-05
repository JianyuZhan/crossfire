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
	evidence?: {
		bar: string | undefined;
		source: string;
	};
	template?: {
		name: string;
		basePreset?: string;
	};
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

function sharedPolicyFields(ctx: RoleInspectionContext) {
	return {
		role: ctx.role,
		adapter: ctx.adapter,
		model: ctx.model,
		preset: ctx.preset,
		evidence: ctx.evidence
			? { bar: ctx.evidence.bar, source: ctx.evidence.source }
			: undefined,
		template: ctx.template,
	};
}

export function buildPolicyInspectionReport(
	contexts: RoleInspectionContext[],
): PolicyInspectionReport {
	return {
		roles: contexts.map((ctx) => {
			const shared = sharedPolicyFields(ctx);
			if (ctx.error) {
				return { ...shared, error: ctx.error };
			}
			return {
				...shared,
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
			const base = {
				role: ctx.role,
				adapter: ctx.adapter,
				model: ctx.model,
				preset: ctx.preset,
			};
			if (ctx.error) {
				return {
					...base,
					tools: [] as ToolInspectionRecord[],
					capabilityEffects: [] as CapabilityEffectRecord[],
					completeness: "minimal" as const,
					warnings: [] as PolicyTranslationWarning[],
					error: ctx.error,
				};
			}
			return {
				...base,
				tools: ctx.observation.toolView,
				capabilityEffects: ctx.observation.capabilityEffects,
				completeness: ctx.observation.completeness,
				warnings: ctx.observation.warnings,
			};
		}),
	};
}
