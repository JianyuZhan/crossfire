// packages/cli/__tests__/commands/preset-options.test.ts
import { describe, expect, it } from "vitest";
import {
	buildInspectionCliOverrides,
	buildPresetConfig,
	parseEvidenceBarValue,
	parsePresetValue,
	parseTurnPresets,
	toCliPresetOverrides,
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

describe("toCliPresetOverrides", () => {
	it("maps preset config into shared CLI override shape", () => {
		const presetConfig = buildPresetConfig({
			preset: "dangerous",
			proposerPreset: "research",
		});
		expect(toCliPresetOverrides(presetConfig)).toEqual({
			cliGlobalPreset: "dangerous",
			cliProposerPreset: "research",
		});
	});
});

describe("buildInspectionCliOverrides", () => {
	it("reuses preset parsing for inspection commands", () => {
		expect(
			buildInspectionCliOverrides({
				preset: "research",
				challengerPreset: "guarded",
			}),
		).toEqual({
			cliGlobalPreset: "research",
			cliChallengerPreset: "guarded",
		});
	});

	it("rejects turn presets for inspection commands", () => {
		expect(() =>
			buildInspectionCliOverrides({
				turnPreset: ["p-1=plan"],
			}),
		).toThrow(/--turn-preset is not supported/);
	});
});

describe("parseEvidenceBarValue", () => {
	it("parses valid evidence bar values", () => {
		expect(parseEvidenceBarValue("low", "--evidence-bar")).toBe("low");
		expect(parseEvidenceBarValue("medium", "--evidence-bar")).toBe("medium");
		expect(parseEvidenceBarValue("high", "--evidence-bar")).toBe("high");
	});

	it("throws for invalid evidence bar value", () => {
		expect(() => parseEvidenceBarValue("extreme", "--evidence-bar")).toThrow(
			"--evidence-bar must be one of: low, medium, high",
		);
	});
});

describe("buildPresetConfig with evidenceBar", () => {
	it("includes evidenceBar when provided", () => {
		const config = buildPresetConfig({ evidenceBar: "high" });
		expect(config?.evidenceBar).toBe("high");
	});

	it("returns undefined when only evidenceBar is absent", () => {
		const config = buildPresetConfig({});
		expect(config).toBeUndefined();
	});
});

describe("toCliPresetOverrides with evidenceBar", () => {
	it("maps evidenceBar to cliEvidenceBar", () => {
		const overrides = toCliPresetOverrides({ evidenceBar: "low" });
		expect(overrides.cliEvidenceBar).toBe("low");
	});

	it("omits cliEvidenceBar when not set", () => {
		const overrides = toCliPresetOverrides({});
		expect(overrides.cliEvidenceBar).toBeUndefined();
	});
});
