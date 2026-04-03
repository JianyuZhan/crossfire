import {
	expectNoWarnings,
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import {
	CLAUDE_SUBAGENT_TOOLS,
	translatePolicy,
} from "../src/policy-translation.js";

describe("translatePolicy (Claude)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> bypassPermissions (exact)", () => {
			const policy = makeResolvedPolicy({
				preset: "dangerous",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("bypassPermissions");
			expect(native.allowDangerouslySkipPermissions).toBe(true);
		});

		it("always -> default (approximate) when capabilities not plan-shaped", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("plan");
		});

		it("on-failure -> default (approximate)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = {
				...base,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer (exact mapping baseline)", () => {
		it("translates to default mode with tool deny list", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.maxTurns).toBe(12);
			expect(native.disallowedTools).toContain("Bash");
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
			expect(native.disallowedTools).not.toContain("Glob");
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toEqual([]);
		});
	});

	describe("golden: plan + judge (plan-shape detection)", () => {
		it("translates to plan permissionMode", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("plan");
			expect(native.allowDangerouslySkipPermissions).toBeUndefined();
		});
	});

	describe("golden: guarded + proposer + approval=always (approximate warning)", () => {
		it("produces approximate warning when shape does not match plan", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer + legacy allow Bash (legacy override conflict)", () => {
		it("drops conflicting legacy allow with approximate warning", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: { allow: ["Bash"] },
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
			expectWarning(warnings, {
				field: "capabilities.legacyToolOverrides.allow",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("capability -> tool deny", () => {
		it("shell off denies Bash", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
		});

		it("filesystem read denies Edit and Write but not Read", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
		});

		it("subagents off denies subagent tools", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
		});
	});

	describe("limits", () => {
		it("maxTurns passes through", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.maxTurns).toBe(12);
		});

		it("unsupported limits produce not_implemented warnings", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				interaction: {
					...base.interaction,
					limits: { maxTurns: 12, maxToolCalls: 50, timeoutMs: 30000 },
				},
			};
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxToolCalls",
				adapter: "claude",
				reason: "not_implemented",
			});
			expectWarning(warnings, {
				field: "interaction.limits.timeoutMs",
				adapter: "claude",
				reason: "not_implemented",
			});
		});
	});

	describe("intentional deltas", () => {
		it("INTENTIONAL DELTA: research maps to default, not dontAsk", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.permissionMode).not.toBe("dontAsk");
		});

		it("INTENTIONAL DELTA: on-risk approval produces no warnings for Claude", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
			});
			const { warnings } = translatePolicy(policy);
			const approvalWarnings = warnings.filter(
				(w) => w.field === "interaction.approval",
			);
			expect(approvalWarnings).toHaveLength(0);
		});
	});
});
