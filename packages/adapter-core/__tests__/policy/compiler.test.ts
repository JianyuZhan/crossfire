import { describe, expect, it } from "vitest";
import { compilePolicy } from "../../src/policy/compiler.js";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";
import { makeCompileInput } from "../../src/testing/index.js";

describe("compilePolicy", () => {
	describe("golden matrix: preset × role", () => {
		it("research × proposer: empty ceiling, read-only capabilities", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "research", role: "proposer" }),
			);
			expect(p.preset).toBe("research");
			expect(p.roleContract.semantics).toEqual({
				exploration: "allowed",
				factCheck: "allowed",
				mayIntroduceNewProposal: true,
			});
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({
				approval: "on-risk",
				limits: { maxTurns: 12 },
			});
		});

		it("research × judge: judge ceiling clamps capabilities", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "research", role: "judge" }),
			);
			expect(p.preset).toBe("research");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.semantics.factCheck).toBe("minimal");
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({
				approval: "on-risk",
				limits: { maxTurns: 12 },
			});
		});

		it("guarded × proposer: write + readonly shell baseline", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "guarded", role: "proposer" }),
			);
			expect(p.preset).toBe("guarded");
			expect(p.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "search",
				shell: "readonly",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "on-risk" });
		});

		it("guarded × challenger: no ceiling, challenger semantics", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "guarded", role: "challenger" }),
			);
			expect(p.preset).toBe("guarded");
			expect(p.roleContract.semantics.mayIntroduceNewProposal).toBe(false);
			expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "search",
				shell: "readonly",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "on-risk" });
		});

		it("dangerous × proposer: full capability path", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "dangerous", role: "proposer" }),
			);
			expect(p.preset).toBe("dangerous");
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "full",
				shell: "exec",
				subagents: "on",
			});
			expect(p.interaction).toEqual({ approval: "never" });
		});

		it("dangerous × judge: all dimensions clamped by judge ceiling", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "dangerous", role: "judge" }),
			);
			expect(p.preset).toBe("dangerous");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "never" });
		});

		it("plan × judge: plan-shape, approval always", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "plan", role: "judge" }),
			);
			expect(p.preset).toBe("plan");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.ceilings).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "always" });
		});
	});

	describe("provider-native leak guard", () => {
		it("ResolvedPolicy keys contain only preset, roleContract, capabilities, interaction, evidence", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "research", role: "proposer" }),
			);
			expect(Object.keys(p).sort()).toEqual(
				[
					"capabilities",
					"evidence",
					"interaction",
					"preset",
					"roleContract",
				].sort(),
			);
		});

		it("capabilities keys contain no provider-native fields", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "dangerous", role: "proposer" }),
			);
			const capKeys = Object.keys(p.capabilities);
			expect(capKeys).not.toContain("permissionMode");
			expect(capKeys).not.toContain("approvalPolicy");
			expect(capKeys).not.toContain("sandboxPolicy");
			expect(capKeys).not.toContain("approvalMode");
		});
	});

	describe("legacy tool overrides", () => {
		it("attaches legacyToolOverrides when provided", () => {
			const p = compilePolicy(
				makeCompileInput({
					legacyToolPolicy: { allow: ["Read", "Grep"], deny: ["WebFetch"] },
				}),
			);
			expect(p.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
			});
		});

		it("skips legacyToolOverrides when both are empty", () => {
			const p = compilePolicy(
				makeCompileInput({ legacyToolPolicy: { allow: [], deny: [] } }),
			);
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("skips legacyToolOverrides when undefined", () => {
			const p = compilePolicy(makeCompileInput());
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("attaches when only allow is provided", () => {
			const p = compilePolicy(
				makeCompileInput({ legacyToolPolicy: { allow: ["Read"] } }),
			);
			expect(p.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(p.capabilities.legacyToolOverrides?.deny).toBeUndefined();
		});
	});

	describe("evidence defaults and overrides", () => {
		it("evidence defaults: proposer gets medium bar from role contract", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "guarded", role: "proposer" }),
			);
			expect(p.evidence).toEqual({ bar: "medium" });
			expect(p.roleContract.evidenceDefaults).toEqual({ bar: "medium" });
		});

		it("evidence defaults: challenger gets high bar from role contract", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "guarded", role: "challenger" }),
			);
			expect(p.evidence).toEqual({ bar: "high" });
			expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
		});

		it("evidence defaults: judge gets high bar from role contract", () => {
			const p = compilePolicy(
				makeCompileInput({ preset: "plan", role: "judge" }),
			);
			expect(p.evidence).toEqual({ bar: "high" });
			expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
		});

		it("evidenceOverride overrides role contract default", () => {
			const p = compilePolicy(
				makeCompileInput({
					preset: "guarded",
					role: "proposer",
					evidenceOverride: { bar: "high" },
				}),
			);
			expect(p.evidence).toEqual({ bar: "high" });
		});

		it("evidenceOverride with undefined bar falls back to role contract", () => {
			const p = compilePolicy(
				makeCompileInput({
					preset: "guarded",
					role: "proposer",
					evidenceOverride: {},
				}),
			);
			expect(p.evidence).toEqual({ bar: "medium" });
		});

		it("interactionOverride overrides approval from preset", () => {
			const p = compilePolicy(
				makeCompileInput({
					preset: "guarded",
					role: "proposer",
					interactionOverride: { approval: "always" },
				}),
			);
			expect(p.interaction.approval).toBe("always");
		});

		it("interactionOverride overrides maxTurns from preset", () => {
			const p = compilePolicy(
				makeCompileInput({
					preset: "research",
					role: "proposer",
					interactionOverride: { limits: { maxTurns: 5 } },
				}),
			);
			expect(p.interaction.limits?.maxTurns).toBe(5);
		});

		it("interactionOverride without fields keeps preset defaults", () => {
			const p = compilePolicy(
				makeCompileInput({
					preset: "guarded",
					role: "proposer",
					interactionOverride: {},
				}),
			);
			expect(p.interaction).toEqual({ approval: "on-risk" });
		});
	});

	describe("immutability", () => {
		it("does not mutate DEFAULT_ROLE_CONTRACTS", () => {
			const before = JSON.stringify(DEFAULT_ROLE_CONTRACTS);
			compilePolicy(makeCompileInput({ preset: "dangerous", role: "judge" }));
			compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			expect(JSON.stringify(DEFAULT_ROLE_CONTRACTS)).toBe(before);
		});

		it("returned policy objects are independent", () => {
			const p1 = compilePolicy(
				makeCompileInput({ preset: "research", role: "proposer" }),
			);
			const p2 = compilePolicy(
				makeCompileInput({ preset: "research", role: "proposer" }),
			);
			expect(p1).toEqual(p2);
			expect(p1).not.toBe(p2);
			expect(p1.roleContract).not.toBe(p2.roleContract);
		});
	});
});
