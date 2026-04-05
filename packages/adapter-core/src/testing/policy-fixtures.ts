/**
 * Canonical policy builders for test fixtures.
 * Internal test-support surface — not a public API, may change without notice.
 * @module
 */
import { compilePolicy } from "../policy/compiler.js";
import type {
	CompilePolicyInput,
	PolicyTranslationWarning,
	ResolvedPolicy,
} from "../policy/types.js";
import type { AdapterId } from "../types.js";

/**
 * Build a canonical CompilePolicyInput. Defaults to guarded + proposer.
 */
export function makeCompileInput(
	overrides: Partial<CompilePolicyInput> & {
		legacyToolPolicy?: unknown;
	} = {},
): CompilePolicyInput {
	return {
		preset: overrides.preset ?? "guarded",
		role: overrides.role ?? "proposer",
		...(overrides.evidenceOverride !== undefined
			? { evidenceOverride: overrides.evidenceOverride }
			: {}),
		...(overrides.interactionOverride !== undefined
			? { interactionOverride: overrides.interactionOverride }
			: {}),
	};
}

/**
 * Build a canonical ResolvedPolicy via the real compiler.
 * Accepts the same overrides as makeCompileInput.
 */
export function makeResolvedPolicy(
	overrides: Partial<CompilePolicyInput> = {},
): ResolvedPolicy {
	return compilePolicy(makeCompileInput(overrides));
}

/**
 * Build a canonical PolicyTranslationWarning. Defaults to an approximate claude warning.
 */
export function makeWarning(
	overrides: Partial<PolicyTranslationWarning> = {},
): PolicyTranslationWarning {
	return {
		field: overrides.field ?? "test.field",
		adapter: overrides.adapter ?? ("claude" as AdapterId),
		reason: overrides.reason ?? "approximate",
		message: overrides.message ?? "Test warning",
	};
}
