// packages/adapter-gemini/src/policy-translation.ts
import type {
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export interface GeminiNativeOptions {
	approvalMode: "default" | "auto_edit" | "plan" | "yolo";
}

function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

function translateApproval(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): GeminiNativeOptions["approvalMode"] {
	if (isPlanShape(policy)) return "plan";
	switch (policy.interaction.approval) {
		case "on-risk":
			return "default";
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no on-failure mode; mapped to auto_edit",
			});
			return "auto_edit";
		case "never":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini yolo is CLI-only; may not be settable at runtime",
			});
			return "yolo";
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no always-approve mode; mapped to default",
			});
			return "default";
	}
}

function warnCapabilities(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): void {
	if (policy.capabilities.filesystem === "off") {
		warnings.push({
			field: "capabilities.filesystem",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling filesystem access",
		});
	}
	if (policy.capabilities.network === "off") {
		warnings.push({
			field: "capabilities.network",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling network access",
		});
	}
	if (policy.capabilities.legacyToolOverrides) {
		warnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini does not consume per-tool allow/deny lists",
		});
	}
}

function warnAllLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
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
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<GeminiNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];
	const approvalMode = translateApproval(policy, warnings);
	warnCapabilities(policy, warnings);
	warnAllLimits(policy.interaction.limits, warnings);
	return { native: { approvalMode }, warnings };
}
