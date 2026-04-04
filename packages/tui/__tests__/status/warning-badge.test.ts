import { describe, expect, it } from "vitest";
import { formatWarningBadge } from "../../src/status/warning-badge.js";

describe("formatWarningBadge", () => {
	it("returns empty string for zero warnings", () => {
		expect(formatWarningBadge(0)).toBe("");
	});

	it("returns badge for non-zero warnings", () => {
		expect(formatWarningBadge(2)).toBe(" ⚠2");
	});

	it("returns badge for one warning", () => {
		expect(formatWarningBadge(1)).toBe(" ⚠1");
	});
});
