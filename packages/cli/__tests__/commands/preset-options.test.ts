// packages/cli/__tests__/commands/preset-options.test.ts
import { describe, expect, it } from "vitest";
import {
	buildPresetConfig,
	parsePresetValue,
	parseTurnPresets,
} from "../../src/commands/preset-options.js";

describe("parsePresetValue", () => {
	it("accepts valid presets", () => {
		expect(parsePresetValue("research", "--preset")).toBe("research");
		expect(parsePresetValue("guarded", "--preset")).toBe("guarded");
		expect(parsePresetValue("dangerous", "--preset")).toBe("dangerous");
		expect(parsePresetValue("plan", "--preset")).toBe("plan");
	});

	it("throws on invalid preset", () => {
		expect(() => parsePresetValue("invalid", "--preset")).toThrow(
			/must be one of/,
		);
	});
});

describe("parseTurnPresets", () => {
	it("parses turnId=preset pairs", () => {
		const result = parseTurnPresets(["p-1=plan", "c-2=dangerous"]);
		expect(result).toEqual({ "p-1": "plan", "c-2": "dangerous" });
	});

	it("throws on malformed entry", () => {
		expect(() => parseTurnPresets(["bad"])).toThrow(/must look like/);
	});
});

describe("buildPresetConfig", () => {
	it("returns undefined when no options given", () => {
		expect(buildPresetConfig({})).toBeUndefined();
	});

	it("builds config with global preset", () => {
		const result = buildPresetConfig({ preset: "dangerous" });
		expect(result?.globalPreset).toBe("dangerous");
	});

	it("builds config with role-specific presets", () => {
		const result = buildPresetConfig({
			proposerPreset: "research",
			challengerPreset: "guarded",
		});
		expect(result?.rolePresets?.proposer).toBe("research");
		expect(result?.rolePresets?.challenger).toBe("guarded");
	});
});
