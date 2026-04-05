// packages/adapter-codex/src/policy-translation.ts
import type {
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
	buildLimitsWarnings,
	resolveApproval,
	resolveSandboxLevel,
} from "./policy-observation.js";

export interface CodexNativeOptions {
	approvalPolicy: "on-request" | "on-failure" | "never";
	sandboxPolicy:
		| { type: "readOnly" }
		| { type: "workspace-write" }
		| { type: "danger-full-access" };
	networkDisabled: boolean;
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<CodexNativeOptions> {
	const approval = resolveApproval(policy.interaction.approval);
	const sandbox = resolveSandboxLevel(policy);
	const warnings: PolicyTranslationWarning[] = [
		...approval.warnings,
		...sandbox.warnings,
	];
	warnings.push(...buildLimitsWarnings(policy.interaction.limits));
	return {
		native: {
			approvalPolicy: approval.approvalPolicy,
			sandboxPolicy: {
				type: sandbox.level,
			} as CodexNativeOptions["sandboxPolicy"],
			networkDisabled: policy.capabilities.network === "off",
		},
		warnings,
	};
}
