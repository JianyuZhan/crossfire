import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Gemini inspectPolicy", () => {
	it("returns minimal completeness", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.completeness).toBe("minimal");
	});

	it("toolView is empty", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.toolView).toEqual([]);
	});

	it("reports approval capability effect", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const approvalEffect = result.capabilityEffects.find(
			(e) => e.field === "interaction.approval",
		);
		expect(approvalEffect).toBeDefined();
	});

	describe("consistency with translatePolicy", () => {
		it("translation summary matches native approvalMode", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const observation = inspectPolicy(policy);
			const translation = translatePolicy(policy);
			expect(observation.translation.nativeSummary.approvalMode).toBe(
				translation.native.approvalMode,
			);
		});
	});

	describe("evidence translation", () => {
		it("emits approximate warning for evidence.bar", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const result = inspectPolicy(policy);
			const evidenceWarning = result.warnings.find(
				(w) => w.field === "evidence.bar",
			);
			expect(evidenceWarning).toBeDefined();
			expect(evidenceWarning?.reason).toBe("approximate");
			expect(evidenceWarning?.adapter).toBe("gemini");
		});
	});
});
