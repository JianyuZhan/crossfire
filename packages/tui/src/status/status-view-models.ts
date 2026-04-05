import type {
	CapabilityEffectRecord,
	EvidenceSource,
	ObservationCompleteness,
	PolicyClampNote,
	PolicyPreset,
	PolicyTranslationSummary,
	PolicyTranslationWarning,
	PresetSource,
	ResolvedPolicy,
	ToolInspectionRecord,
} from "@crossfire/adapter-core";
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";

export interface StatusPolicyView {
	role: string;
	adapter: string;
	model: string;
	baseline: {
		preset: { value: PolicyPreset; source: PresetSource };
		policy: ResolvedPolicy;
		clamps: readonly PolicyClampNote[];
		translationSummary: PolicyTranslationSummary;
		warnings: readonly PolicyTranslationWarning[];
		evidenceSource?: EvidenceSource;
		template?: { name: string; basePreset?: string };
	};
	override?: {
		turnId: string;
		preset: PolicyPreset;
		policy: ResolvedPolicy;
		translationSummary: PolicyTranslationSummary;
		warnings: readonly PolicyTranslationWarning[];
	};
}

export interface StatusToolsView {
	role: string;
	adapter: string;
	source: "baseline" | "override";
	toolView: readonly ToolInspectionRecord[];
	capabilityEffects: readonly CapabilityEffectRecord[];
	completeness: ObservationCompleteness;
	warnings: readonly PolicyTranslationWarning[];
}

export function buildStatusPolicyView(
	role: string,
	adapter: string,
	model: string,
	state: RuntimePolicyState,
): StatusPolicyView {
	const view: StatusPolicyView = {
		role,
		adapter,
		model,
		baseline: {
			preset: state.baseline.preset,
			policy: state.baseline.policy,
			clamps: state.baseline.clamps,
			translationSummary: state.baseline.translationSummary,
			warnings: state.baseline.warnings,
			evidenceSource: state.baseline.evidence?.source,
			template: state.baseline.template,
		},
	};
	if (state.currentTurnOverride) {
		view.override = {
			turnId: state.currentTurnOverride.turnId,
			preset: state.currentTurnOverride.preset,
			policy: state.currentTurnOverride.policy,
			translationSummary: state.currentTurnOverride.translationSummary,
			warnings: state.currentTurnOverride.warnings,
		};
	}
	return view;
}

export function buildStatusToolsView(
	role: string,
	adapter: string,
	state: RuntimePolicyState,
): StatusToolsView {
	const activeOverride = state.currentTurnOverride;
	const observation = activeOverride
		? activeOverride.observation
		: state.baseline.observation;
	const warnings = activeOverride
		? activeOverride.warnings
		: state.baseline.warnings;

	return {
		role,
		adapter,
		source: activeOverride ? "override" : "baseline",
		toolView: observation.toolView,
		capabilityEffects: observation.capabilityEffects,
		completeness: observation.completeness,
		warnings,
	};
}
