// packages/adapter-codex/src/policy-observation.ts
import type {
	CapabilityEffectRecord,
	PolicyTranslationWarning,
	ProviderObservationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export function resolveApproval(
	approval: ResolvedPolicy["interaction"]["approval"],
): {
	approvalPolicy: "on-request" | "on-failure" | "never";
	warnings: PolicyTranslationWarning[];
} {
	const warnings: PolicyTranslationWarning[] = [];
	switch (approval) {
		case "on-failure":
			return { approvalPolicy: "on-failure", warnings };
		case "never":
			return { approvalPolicy: "never", warnings };
		case "on-risk":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no on-risk approval; mapped to on-request",
			});
			return { approvalPolicy: "on-request", warnings };
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no always-approve mode; mapped to on-request",
			});
			return { approvalPolicy: "on-request", warnings };
	}
}

export function resolveSandboxLevel(policy: ResolvedPolicy): {
	level: string;
	warnings: PolicyTranslationWarning[];
} {
	const warnings: PolicyTranslationWarning[] = [];
	let level = "readOnly";
	if (policy.capabilities.filesystem === "write") level = "workspace-write";
	if (policy.capabilities.shell === "exec") level = "danger-full-access";
	if (policy.capabilities.network === "full") {
		level = "danger-full-access";
		warnings.push({
			field: "capabilities.network",
			adapter: "codex",
			reason: "approximate",
			message: "Codex full network requires danger-full-access sandbox",
		});
	}
	return { level, warnings };
}

export function resolveCapabilityEffects(
	policy: ResolvedPolicy,
	sandboxLevel: string,
): CapabilityEffectRecord[] {
	return [
		{
			field: "sandbox",
			status: "applied",
			details: `sandbox=${sandboxLevel}`,
		},
		{
			field: "capabilities.network",
			status:
				policy.capabilities.network === "off" ? "applied" : "approximated",
			details: `networkDisabled=${policy.capabilities.network === "off"}`,
		},
	];
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
				adapter: "codex",
				reason: "not_implemented",
				message: `Codex does not support ${key} limit`,
			});
		}
	}
	return warnings;
}

export function inspectPolicy(
	policy: ResolvedPolicy,
): ProviderObservationResult {
	const approval = resolveApproval(policy.interaction.approval);
	const sandbox = resolveSandboxLevel(policy);
	const capabilityEffects = resolveCapabilityEffects(policy, sandbox.level);
	const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);
	const legacyWarnings: PolicyTranslationWarning[] = [];
	if (policy.capabilities.legacyToolOverrides) {
		legacyWarnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not consume per-tool allow/deny lists",
		});
	}

	const evidenceWarnings: PolicyTranslationWarning[] = [];
	if (policy.evidence) {
		evidenceWarnings.push({
			field: "evidence.bar",
			adapter: "codex",
			reason: "approximate",
			message: `Codex cannot natively enforce evidence bar; setting influences prompting only (configured: ${policy.evidence.bar})`,
		});
	}

	const allWarnings = [
		...approval.warnings,
		...sandbox.warnings,
		...legacyWarnings,
		...limitsWarnings,
		...evidenceWarnings,
	];

	return {
		translation: {
			adapter: "codex",
			nativeSummary: {
				approvalPolicy: approval.approvalPolicy,
				sandboxPolicy: sandbox.level,
				networkDisabled: policy.capabilities.network === "off",
			},
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
		capabilityEffects,
		warnings: allWarnings,
		completeness: "minimal",
	};
}
