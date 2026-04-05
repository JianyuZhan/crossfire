import {
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Codex)", () => {
	describe("approval mapping", () => {
		it("on-risk -> on-request (approximate)", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
			});
		});

		it("on-failure -> on-failure (exact)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = {
				...base,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-failure");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> never (exact)", () => {
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("never");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toEqual([]);
		});

		it("always -> on-request (approximate)", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer (readOnly sandbox)", () => {
		it("translates to readOnly sandbox with network not disabled", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "readOnly" });
			expect(native.networkDisabled).toBe(false);
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "codex",
				reason: "not_implemented",
			});
		});
	});

	describe("golden: guarded + proposer (workspace-write sandbox)", () => {
		it("translates to workspace-write sandbox", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "workspace-write" });
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("golden: dangerous + proposer (danger-full-access sandbox)", () => {
		it("translates to danger-full-access sandbox with network warning", () => {
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "danger-full-access" });
			expect(native.networkDisabled).toBe(false);
			expectWarning(warnings, {
				field: "capabilities.network",
				adapter: "codex",
				reason: "approximate",
			});
		});
	});

	describe("legacy tool override removal", () => {
		it("no longer emits warnings for legacy tool overrides", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			const legacyWarnings = warnings.filter((w) =>
				w.field.includes("legacyToolOverrides"),
			);
			expect(legacyWarnings).toEqual([]);
		});
	});

	describe("network disabled", () => {
		it("network off -> networkDisabled true", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				capabilities: { ...base.capabilities, network: "off" as const },
			};
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(true);
		});

		it("network search -> networkDisabled false", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("limits", () => {
		it("maxTurns produces not_implemented warning", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "codex",
				reason: "not_implemented",
			});
		});
	});

	describe("intentional deltas", () => {
		it("INTENTIONAL DELTA: on-risk maps to on-request, not a direct match", () => {
			// Old behavior: Codex had no concept of on-risk; callers had to pick a mode manually
			// New behavior: on-risk is explicitly mapped to on-request (closest Codex equivalent)
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			// New behavior holds
			expect(native.approvalPolicy).toBe("on-request");
			expect(native.approvalPolicy).not.toBe("on-failure");
			// Mapping is marked approximate (not exact)
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
			});
		});
	});
});
