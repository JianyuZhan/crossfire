/**
 * Structured warning assertion helpers for policy translation tests.
 * Internal test-support surface — not a public API, may change without notice.
 * @module
 */
import type { PolicyTranslationWarning } from "../policy/types.js";
import type { AdapterId } from "../types.js";

export interface WarningMatch {
	field: string;
	adapter: AdapterId;
	reason: PolicyTranslationWarning["reason"];
}

export interface WarningMatchWithMessage extends WarningMatch {
	messageContains: string;
}

function matchesWarning(
	w: PolicyTranslationWarning,
	match: WarningMatch,
): boolean {
	return (
		w.field === match.field &&
		w.adapter === match.adapter &&
		w.reason === match.reason
	);
}

function formatWarnings(warnings: readonly PolicyTranslationWarning[]): string {
	if (warnings.length === 0) return "(none)";
	return warnings
		.map(
			(w) =>
				`{field: "${w.field}", adapter: "${w.adapter}", reason: "${w.reason}"}`,
		)
		.join(", ");
}

/**
 * Assert that at least one warning matches field + adapter + reason (partial match).
 * Throws with descriptive message if no match is found.
 */
export function expectWarning(
	warnings: readonly PolicyTranslationWarning[],
	match: WarningMatch,
): void {
	const found = warnings.some((w) => matchesWarning(w, match));
	if (!found) {
		throw new Error(
			`Expected warning {field: "${match.field}", adapter: "${match.adapter}", reason: "${match.reason}"} ` +
				`not found. Available: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Assert that at least one warning matches field + adapter + reason AND message contains substring.
 * Throws with descriptive message if no match is found.
 */
export function expectWarningWithMessage(
	warnings: readonly PolicyTranslationWarning[],
	match: WarningMatchWithMessage,
): void {
	const found = warnings.some(
		(w) =>
			matchesWarning(w, match) && w.message.includes(match.messageContains),
	);
	if (!found) {
		throw new Error(
			`Expected warning {field: "${match.field}", adapter: "${match.adapter}", reason: "${match.reason}", ` +
				`messageContains: "${match.messageContains}"} not found. Available: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Assert that the warnings array is empty.
 * Throws with descriptive message listing unexpected warnings.
 */
export function expectNoWarnings(
	warnings: readonly PolicyTranslationWarning[],
): void {
	if (warnings.length > 0) {
		throw new Error(
			`Expected no warnings but found ${warnings.length}: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Sort warnings by field -> reason -> adapter for stable comparison.
 * Returns a new array; does not mutate the input.
 */
export function normalizeWarnings(
	warnings: readonly PolicyTranslationWarning[],
): PolicyTranslationWarning[] {
	return [...warnings].sort(
		(a, b) =>
			a.field.localeCompare(b.field) ||
			a.reason.localeCompare(b.reason) ||
			a.adapter.localeCompare(b.adapter),
	);
}
