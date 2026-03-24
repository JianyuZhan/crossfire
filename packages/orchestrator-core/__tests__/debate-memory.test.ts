import { describe, expect, it } from "vitest";
import { filterUnresolved, isAcknowledged } from "../src/debate-memory.js";

describe("isAcknowledged", () => {
	it("returns true when concession contains first 20 chars of point", () => {
		expect(
			isAcknowledged("Transparency benefits open source", [
				"transparency benefits are real but limited",
			]),
		).toBe(true);
	});

	it("returns true when point contains first 20 chars of concession", () => {
		expect(
			isAcknowledged("IP protection is important for revenue", [
				"ip protection is imp",
			]),
		).toBe(true);
	});

	it("returns false when no overlap", () => {
		expect(
			isAcknowledged("Innovation drives progress", ["Cost savings matter"]),
		).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(isAcknowledged("TRANSPARENCY IS KEY", ["transparency is key"])).toBe(
			true,
		);
	});

	it("returns false for empty concessions", () => {
		expect(isAcknowledged("Some point", [])).toBe(false);
	});
});

describe("filterUnresolved", () => {
	it("returns points not acknowledged by concessions", () => {
		const result = filterUnresolved(
			["Innovation matters", "Cost is high"],
			["innovation matters in some areas"],
		);
		expect(result).toEqual(["Cost is high"]);
	});

	it("deduplicates by exact string", () => {
		const result = filterUnresolved(["Point A", "Point A", "Point B"], []);
		expect(result).toEqual(["Point A", "Point B"]);
	});

	it("preserves input order", () => {
		const result = filterUnresolved(["Zebra", "Apple", "Mango"], []);
		expect(result).toEqual(["Zebra", "Apple", "Mango"]);
	});

	it("returns empty array when all acknowledged", () => {
		const result = filterUnresolved(
			["Innovation matters"],
			["innovation matters completely"],
		);
		expect(result).toEqual([]);
	});
});
