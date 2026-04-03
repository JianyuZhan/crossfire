import { compilePolicy } from "@crossfire/adapter-core";
// packages/adapter-codex/__tests__/policy-translation.test.ts
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Codex)", () => {
	describe("approval mapping", () => {
		it("on-risk -> on-request (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
		});

		it("on-failure -> on-failure (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.approvalPolicy).toBe("on-failure");
			expect(
				warnings.filter((w) => w.field === "interaction.approval"),
			).toEqual([]);
		});

		it("never -> never (exact)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("never");
		});

		it("always -> on-request (approximate)", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("sandbox mapping", () => {
		it("research (read, search, shell off) -> readOnly", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "readOnly" });
		});

		it("guarded (write, readonly shell) -> workspace-write", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "workspace-write" });
		});

		it("dangerous (exec, full) -> danger-full-access", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "danger-full-access" });
		});
	});

	describe("network disabled", () => {
		it("network off -> networkDisabled true", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				capabilities: { ...policy.capabilities, network: "off" as const },
			};
			const { native } = translatePolicy(modified);
			expect(native.networkDisabled).toBe(true);
		});

		it("network search -> networkDisabled false", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("limits", () => {
		it("maxTurns produces not_implemented warning", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxTurns",
					adapter: "codex",
					reason: "not_implemented",
				}),
			);
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
					adapter: "codex",
					reason: "not_implemented",
				}),
			);
		});
	});
});
