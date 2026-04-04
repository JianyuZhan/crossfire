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
	if (policy.capabilities.legacyToolOverrides) {
		warnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini does not consume per-tool allow/deny lists",
		});
	}
	warnings.push(...buildLimitsWarnings(policy.interaction.limits));
	return {
		native: { approvalMode: approval.approvalMode },
		warnings,
	};
}
