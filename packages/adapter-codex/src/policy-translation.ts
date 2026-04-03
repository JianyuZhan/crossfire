// packages/adapter-codex/src/policy-translation.ts
import type {
	CapabilityPolicy,
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export interface CodexNativeOptions {
	approvalPolicy: "on-request" | "on-failure" | "never";
	sandboxPolicy:
		| { type: "readOnly" }
		| { type: "workspace-write" }
		| { type: "danger-full-access" };
	networkDisabled: boolean;
}

type SandboxLevel = "readOnly" | "workspace-write" | "danger-full-access";
const SANDBOX_ORDER: SandboxLevel[] = [
	"readOnly",
	"workspace-write",
	"danger-full-access",
];

function maxSandbox(a: SandboxLevel, b: SandboxLevel): SandboxLevel {
	return SANDBOX_ORDER[
		Math.max(SANDBOX_ORDER.indexOf(a), SANDBOX_ORDER.indexOf(b))
	];
}

function translateApproval(
	approval: ResolvedPolicy["interaction"]["approval"],
	warnings: PolicyTranslationWarning[],
): CodexNativeOptions["approvalPolicy"] {
	switch (approval) {
		case "on-failure":
			return "on-failure";
		case "never":
			return "never";
		case "on-risk":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no on-risk approval; mapped to on-request",
			});
			return "on-request";
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no always-approve mode; mapped to on-request",
			});
			return "on-request";
	}
}

function translateSandbox(
	capabilities: CapabilityPolicy,
	warnings: PolicyTranslationWarning[],
): CodexNativeOptions["sandboxPolicy"] {
	let level: SandboxLevel = "readOnly";
	if (capabilities.filesystem === "write")
		level = maxSandbox(level, "workspace-write");
	if (capabilities.shell === "exec")
		level = maxSandbox(level, "danger-full-access");
	if (capabilities.network === "full") {
		level = maxSandbox(level, "danger-full-access");
		warnings.push({
			field: "capabilities.network",
			adapter: "codex",
			reason: "approximate",
			message: "Codex full network requires danger-full-access sandbox",
		});
	}
	return { type: level };
}

function warnUnsupportedLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
	if (limits.maxTurns !== undefined)
		warnings.push({
			field: "interaction.limits.maxTurns",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support per-session turn limits",
		});
	if (limits.maxToolCalls !== undefined)
		warnings.push({
			field: "interaction.limits.maxToolCalls",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support maxToolCalls limit",
		});
	if (limits.timeoutMs !== undefined)
		warnings.push({
			field: "interaction.limits.timeoutMs",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support timeoutMs limit",
		});
	if (limits.budgetUsd !== undefined)
		warnings.push({
			field: "interaction.limits.budgetUsd",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support budgetUsd limit",
		});
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<CodexNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];
	const approvalPolicy = translateApproval(
		policy.interaction.approval,
		warnings,
	);
	const sandboxPolicy = translateSandbox(policy.capabilities, warnings);
	const networkDisabled = policy.capabilities.network === "off";
	if (policy.capabilities.legacyToolOverrides) {
		warnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not consume per-tool allow/deny lists",
		});
	}
	warnUnsupportedLimits(policy.interaction.limits, warnings);
	return {
		native: { approvalPolicy, sandboxPolicy, networkDisabled },
		warnings,
	};
}
