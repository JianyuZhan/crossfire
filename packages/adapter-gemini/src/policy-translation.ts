// packages/adapter-gemini/src/policy-translation.ts
import type {
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
	buildLimitsWarnings,
	resolveApproval,
	resolveCapabilityEffects,
} from "./policy-observation.js";

export interface GeminiNativeOptions {
	approvalMode: "default" | "auto_edit" | "plan" | "yolo";
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<GeminiNativeOptions> {
	const approval = resolveApproval(policy);
	const capabilities = resolveCapabilityEffects(policy);
	const warnings: PolicyTranslationWarning[] = [
		...approval.warnings,
		...capabilities.warnings,
	];
	warnings.push(...buildLimitsWarnings(policy.interaction.limits));
	return {
		native: { approvalMode: approval.approvalMode },
		warnings,
	};
}
