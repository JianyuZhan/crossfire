// packages/adapter-codex/__tests__/policy-observation.test.ts
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Codex inspectPolicy", () => {
	it("returns minimal completeness", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.completeness).toBe("minimal");
	});

	it("toolView is empty (Codex has no discrete tool surface)", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.toolView).toEqual([]);
	});

	it("reports sandbox-level capability effects", () => {
		const policy = makeResolvedPolicy({
			preset: "dangerous",
			role: "proposer",
		});
		const result = inspectPolicy(policy);
		const sandboxEffect = result.capabilityEffects.find(
			(e) => e.field === "sandbox",
		);
		expect(sandboxEffect).toBeDefined();
		expect(sandboxEffect?.status).toBe("applied");
	});

	describe("consistency with translatePolicy", () => {
		it("warnings are superset of translation warnings", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const observation = inspectPolicy(policy);
			const translation = translatePolicy(policy);
			for (const tw of translation.warnings) {
				const found = observation.warnings.some(
					(ow) => ow.field === tw.field && ow.reason === tw.reason,
				);
				expect(found, `Missing warning for ${tw.field}`).toBe(true);
			}
		});
	});
});
