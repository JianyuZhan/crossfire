// packages/adapter-gemini/src/policy-observation.ts
import type {
	CapabilityEffectRecord,
	PolicyTranslationWarning,
	ProviderObservationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

export function resolveApproval(policy: ResolvedPolicy): {
	approvalMode: "default" | "auto_edit" | "plan" | "yolo";
	warnings: PolicyTranslationWarning[];
} {
	const warnings: PolicyTranslationWarning[] = [];
	if (isPlanShape(policy)) return { approvalMode: "plan", warnings };
	switch (policy.interaction.approval) {
		case "on-risk":
			return { approvalMode: "default", warnings };
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no on-failure mode; mapped to auto_edit",
			});
			return { approvalMode: "auto_edit", warnings };
		case "never":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini yolo is CLI-only; may not be settable at runtime",
			});
			return { approvalMode: "yolo", warnings };
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no always-approve mode; mapped to default",
			});
			return { approvalMode: "default", warnings };
	}
}

export function resolveCapabilityEffects(policy: ResolvedPolicy): {
	effects: CapabilityEffectRecord[];
	warnings: PolicyTranslationWarning[];
} {
	const effects: CapabilityEffectRecord[] = [];
	const warnings: PolicyTranslationWarning[] = [];

	effects.push({
		field: "interaction.approval",
		status: "applied",
		details: `approvalMode resolved from approval=${policy.interaction.approval}`,
	});

	if (policy.capabilities.filesystem === "off") {
		effects.push({
			field: "capabilities.filesystem",
			status: "not_implemented",
			details: "Gemini CLI does not support disabling filesystem access",
		});
		warnings.push({
			field: "capabilities.filesystem",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling filesystem access",
		});
	}
	if (policy.capabilities.network === "off") {
		effects.push({
			field: "capabilities.network",
			status: "not_implemented",
			details: "Gemini CLI does not support disabling network access",
		});
		warnings.push({
			field: "capabilities.network",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling network access",
		});
	}

	return { effects, warnings };
}

export function buildLimitsWarnings(
	limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
	const warnings: PolicyTranslationWarning[] = [];
	if (!limits) return warnings;
	for (const [key, value] of Object.entries(limits)) {
		if (value !== undefined) {
			warnings.push({
				field: `interaction.limits.${key}`,
				adapter: "gemini",
				reason: "not_implemented",
				message: `Gemini does not support ${key} limit`,
			});
		}
	}
	return warnings;
}

export function inspectPolicy(
	policy: ResolvedPolicy,
): ProviderObservationResult {
	const approval = resolveApproval(policy);
	const capabilities = resolveCapabilityEffects(policy);
	const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

	const evidenceWarnings: PolicyTranslationWarning[] = [];
	if (policy.evidence) {
		evidenceWarnings.push({
			field: "evidence.bar",
			adapter: "gemini",
			reason: "approximate",
			message: `Gemini cannot natively enforce evidence bar; setting influences prompting only (configured: ${policy.evidence.bar})`,
		});
	}

	const allWarnings = [
		...approval.warnings,
		...capabilities.warnings,
		...limitsWarnings,
		...evidenceWarnings,
	];

	return {
		translation: {
			adapter: "gemini",
			nativeSummary: { approvalMode: approval.approvalMode },
			exactFields:
				approval.warnings.length === 0 ? ["interaction.approval"] : [],
			approximateFields: allWarnings
				.filter((w) => w.reason === "approximate")
				.map((w) => w.field),
			unsupportedFields: allWarnings
				.filter((w) => w.reason === "not_implemented")
				.map((w) => w.field),
		},
		toolView: [],
		capabilityEffects: capabilities.effects,
		warnings: allWarnings,
		completeness: "minimal",
	};
}
