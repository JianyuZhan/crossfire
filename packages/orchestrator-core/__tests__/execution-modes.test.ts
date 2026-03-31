import { describe, expect, it } from "vitest";
import { resolveExecutionMode } from "../src/execution-modes.js";

describe("resolveExecutionMode", () => {
	it("defaults to guarded when no execution config is set", () => {
		expect(resolveExecutionMode(undefined, "proposer", "p-1")).toEqual({
			baselineMode: "guarded",
			effectiveMode: "guarded",
			source: "debate-default",
		});
	});

	it("uses the debate default when no role override exists", () => {
		expect(
			resolveExecutionMode({ defaultMode: "research" }, "challenger", "c-1"),
		).toEqual({
			baselineMode: "research",
			effectiveMode: "research",
			source: "debate-default",
		});
	});

	it("prefers the role baseline over the debate default", () => {
		expect(
			resolveExecutionMode(
				{
					defaultMode: "guarded",
					roleModes: { proposer: "dangerous" },
				},
				"proposer",
				"p-1",
			),
		).toEqual({
			baselineMode: "dangerous",
			effectiveMode: "dangerous",
			source: "role-baseline",
		});
	});

	it("lets a per-turn override win over the role baseline", () => {
		expect(
			resolveExecutionMode(
				{
					defaultMode: "guarded",
					roleModes: { proposer: "research" },
					turnOverrides: { "p-1": "plan" },
				},
				"proposer",
				"p-1",
			),
		).toEqual({
			baselineMode: "research",
			effectiveMode: "plan",
			source: "turn-override",
		});
	});
});
