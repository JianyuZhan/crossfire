import { compilePolicy } from "@crossfire/adapter-core";
import { describe, expect, it } from "vitest";
import {
	CLAUDE_SUBAGENT_TOOLS,
	translatePolicy,
} from "../src/policy-translation.js";

describe("translatePolicy (Claude)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(
				warnings.filter((w) => w.field === "interaction.approval"),
			).toEqual([]);
		});

		it("never -> bypassPermissions (exact)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("bypassPermissions");
			expect(native.allowDangerouslySkipPermissions).toBe(true);
		});

		it("always -> default (approximate) when capabilities not plan-shaped", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "always" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.permissionMode).toBe("default");
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
			expect(native.permissionMode).toBe("plan");
		});

		it("on-failure -> default (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.permissionMode).toBe("default");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("intentional behavior delta", () => {
		it("research preset no longer maps to dontAsk for Claude", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.permissionMode).not.toBe("dontAsk");
		});
	});

	describe("capability -> tool deny", () => {
		it("shell off denies Bash", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
		});

		it("filesystem read denies Edit and Write", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
		});

		it("subagents off denies subagent tools", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
		});
	});

	describe("legacy tool overrides", () => {
		it("cannot breach enum ceiling", () => {
			const policy = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: { allow: ["Bash"] },
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.legacyToolOverrides.allow",
					reason: "approximate",
				}),
			);
		});
	});

	describe("limits", () => {
		it("maxTurns passes through", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.maxTurns).toBe(12);
		});

		it("unsupported limits produce warnings", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				interaction: {
					...policy.interaction,
					limits: { maxTurns: 12, maxToolCalls: 50, timeoutMs: 30000 },
				},
			};
			const { warnings } = translatePolicy(modified);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxToolCalls",
					reason: "not_implemented",
				}),
			);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.timeoutMs",
					reason: "not_implemented",
				}),
			);
		});
	});
});
