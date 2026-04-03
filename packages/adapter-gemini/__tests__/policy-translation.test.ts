import { compilePolicy } from "@crossfire/adapter-core";
// packages/adapter-gemini/__tests__/policy-translation.test.ts
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Gemini)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
		});

		it("never -> yolo (approximate)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});

		it("always -> default when shape does not match", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "always" as const },
			};
			const { native } = translatePolicy(modified);
			expect(native.approvalMode).toBe("default");
		});

		it("on-failure -> auto_edit (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.approvalMode).toBe("auto_edit");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("capability warnings", () => {
		it("filesystem off produces not_implemented warning", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				capabilities: { ...policy.capabilities, filesystem: "off" as const },
			};
			const { warnings } = translatePolicy(modified);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.filesystem",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});

		it("shell off does NOT produce warning (Gemini default is no shell)", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { warnings } = translatePolicy(policy);
			const shellWarnings = warnings.filter(
				(w) => w.field === "capabilities.shell",
			);
			expect(shellWarnings).toEqual([]);
		});
	});

	describe("legacy tool overrides", () => {
		it("emits not_implemented warning when present", () => {
			const policy = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.legacyToolOverrides",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});
	});

	describe("limits", () => {
		it("all limits produce not_implemented warnings", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxTurns",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});
	});
});
