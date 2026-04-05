import {
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Gemini)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> yolo (approximate)", () => {
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});

		it("always -> default when shape does not match", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});

		it("on-failure -> auto_edit (approximate)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = {
				...base,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("auto_edit");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});

	describe("golden: plan + judge (plan approval mode)", () => {
		it("translates to plan approvalMode", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});
	});

	describe("golden: research + proposer (default mode baseline)", () => {
		it("translates to default with maxTurns not_implemented warning", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});
	});

	describe("golden: dangerous + proposer (yolo mode + warnings)", () => {
		it("translates to yolo with approval approximate warning", () => {
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});

	describe("legacy tool override removal", () => {
		it("does not emit legacy override warnings", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { warnings } = translatePolicy(policy);
			const legacyWarnings = warnings.filter((w) =>
				w.field.includes("legacyToolOverrides"),
			);
			expect(legacyWarnings).toEqual([]);
		});
	});

	describe("capability warnings", () => {
		it("filesystem off produces not_implemented warning", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				capabilities: { ...base.capabilities, filesystem: "off" as const },
			};
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "capabilities.filesystem",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});

		it("shell off does NOT produce warning (Gemini default is no shell)", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { warnings } = translatePolicy(policy);
			const shellWarnings = warnings.filter(
				(w) => w.field === "capabilities.shell",
			);
			expect(shellWarnings).toEqual([]);
		});
	});

	describe("limits", () => {
		it("all limits produce not_implemented warnings", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});
	});

	describe("intentional deltas", () => {
		it("INTENTIONAL DELTA: on-risk approval is exact for Gemini, unlike on-failure", () => {
			// Old behavior: all non-yolo modes mapped uniformly
			// New behavior: on-risk -> default is exact, on-failure -> auto_edit is approximate
			// Reason: Gemini's default mode closely matches on-risk semantics
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			expect(native.approvalMode).not.toBe("auto_edit");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toHaveLength(0);
		});

		it("INTENTIONAL DELTA: yolo is approximate, not exact", () => {
			// Old behavior: dangerous -> yolo treated as a direct mapping
			// New behavior: yolo is marked approximate because it is a CLI-only flag
			// Reason: yolo may not be settable at runtime via API
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).not.toHaveLength(0);
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});
});
