import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Claude inspectPolicy", () => {
	it("returns partial completeness", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.completeness).toBe("partial");
	});

	it("reports known builtin tools", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const toolNames = result.toolView.map((t) => t.name);
		expect(toolNames).toContain("Bash");
		expect(toolNames).toContain("Read");
		expect(toolNames).toContain("WebFetch");
	});

	it("blocks shell tools when shell=off", () => {
		const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
		const result = inspectPolicy(policy);
		const bash = result.toolView.find((t) => t.name === "Bash");
		expect(bash?.status).toBe("blocked");
		expect(bash?.reason).toBe("capability_policy");
		expect(bash?.source).toBe("builtin");
	});

	it("allows shell tools when shell=exec", () => {
		const policy = makeResolvedPolicy({
			preset: "dangerous",
			role: "proposer",
		});
		const result = inspectPolicy(policy);
		const bash = result.toolView.find((t) => t.name === "Bash");
		expect(bash?.status).toBe("allowed");
	});

	it("includes capabilityEffects for all modeled dimensions", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const fields = result.capabilityEffects.map((e) => e.field);
		expect(fields).toContain("capabilities.filesystem");
		expect(fields).toContain("capabilities.shell");
		expect(fields).toContain("capabilities.network");
		expect(fields).toContain("capabilities.subagents");
	});

	it("legacy allow list never overstates access versus translation", () => {
		const policy = makeResolvedPolicy({
			preset: "dangerous",
			role: "proposer",
			legacyToolPolicy: {
				allow: ["Read"],
				deny: ["WebFetch"],
			},
		});
		const observation = inspectPolicy(policy);
		const translation = translatePolicy(policy);
		const read = observation.toolView.find((tool) => tool.name === "Read");
		const bash = observation.toolView.find((tool) => tool.name === "Bash");
		const webFetch = observation.toolView.find(
			(tool) => tool.name === "WebFetch",
		);
		expect(read?.status).toBe("allowed");
		expect(read?.reason).toBe("legacy_override");
		expect(bash?.status).toBe("blocked");
		expect(bash?.reason).toBe("legacy_override");
		expect(webFetch?.status).toBe("blocked");
		expect(webFetch?.reason).toBe("legacy_override");
		expect(translation.native.allowedTools).toEqual(["Read"]);
		expect(translation.native.disallowedTools).toContain("WebFetch");
	});

	describe("consistency with translatePolicy", () => {
		it("warnings are consistent under same policy", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const observation = inspectPolicy(policy);
			const translation = translatePolicy(policy);
			// observation warnings are superset of translation warnings
			for (const tw of translation.warnings) {
				const found = observation.warnings.some(
					(ow) =>
						ow.field === tw.field &&
						ow.adapter === tw.adapter &&
						ow.reason === tw.reason,
				);
				expect(found, `Missing observation warning for ${tw.field}`).toBe(true);
			}
		});

		it("translation summary matches native permissionMode", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const observation = inspectPolicy(policy);
			const translation = translatePolicy(policy);
			expect(observation.translation.nativeSummary.permissionMode).toBe(
				translation.native.permissionMode,
			);
		});
	});
});
