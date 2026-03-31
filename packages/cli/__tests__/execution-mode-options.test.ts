import { describe, expect, it } from "vitest";
import {
	buildExecutionModeConfig,
	collectOptionValues,
} from "../src/commands/execution-mode-options.js";

describe("execution mode option parsing", () => {
	it("returns undefined when no execution mode options are set", () => {
		expect(buildExecutionModeConfig({})).toBeUndefined();
	});

	it("builds debate default and role baselines", () => {
		expect(
			buildExecutionModeConfig({
				mode: "guarded",
				proposerMode: "research",
				challengerMode: "dangerous",
			}),
		).toEqual({
			defaultMode: "guarded",
			roleModes: {
				proposer: "research",
				challenger: "dangerous",
			},
		});
	});

	it("builds per-turn overrides including plan", () => {
		expect(
			buildExecutionModeConfig({
				turnMode: ["p-1=plan", "c-2=research"],
			}),
		).toEqual({
			turnOverrides: {
				"p-1": "plan",
				"c-2": "research",
			},
		});
	});

	it("collects repeated commander option values", () => {
		expect(collectOptionValues("p-1=plan", ["c-1=research"])).toEqual([
			"c-1=research",
			"p-1=plan",
		]);
	});

	it("throws on invalid role modes", () => {
		expect(() =>
			buildExecutionModeConfig({
				proposerMode: "plan",
			}),
		).toThrow("--proposer-mode must be one of");
	});

	it("throws on malformed per-turn overrides", () => {
		expect(() =>
			buildExecutionModeConfig({
				turnMode: ["p-1"],
			}),
		).toThrow("--turn-mode entries must look like");
	});
});
