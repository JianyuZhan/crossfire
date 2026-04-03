import { describe, expect, it } from "vitest";
import { compilePolicy } from "../../src/policy/compiler.js";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";

describe("compilePolicy", () => {
	describe("preset x role combinations", () => {
		it("research + proposer: no clamping (empty ceilings)", () => {
			const p = compilePolicy({ preset: "research", role: "proposer" });
			expect(p.preset).toBe("research");
			expect(p.capabilities.filesystem).toBe("read");
			expect(p.capabilities.shell).toBe("off");
			expect(p.interaction.approval).toBe("on-risk");
			expect(p.interaction.limits?.maxTurns).toBe(12);
		});

		it("research + judge: capabilities clamped by judge ceilings", () => {
			const p = compilePolicy({ preset: "research", role: "judge" });
			expect(p.capabilities.network).toBe("search");
			expect(p.capabilities.shell).toBe("off");
			expect(p.capabilities.subagents).toBe("off");
		});

		it("dangerous + judge: capabilities clamped down hard", () => {
			const p = compilePolicy({ preset: "dangerous", role: "judge" });
			expect(p.capabilities.shell).toBe("off");
			expect(p.capabilities.network).toBe("search");
			expect(p.capabilities.subagents).toBe("off");
			expect(p.capabilities.filesystem).toBe("read");
		});

		it("dangerous + proposer: no clamping", () => {
			const p = compilePolicy({ preset: "dangerous", role: "proposer" });
			expect(p.capabilities.shell).toBe("exec");
			expect(p.capabilities.network).toBe("full");
			expect(p.capabilities.subagents).toBe("on");
			expect(p.capabilities.filesystem).toBe("write");
		});

		it("guarded + challenger: no clamping", () => {
			const p = compilePolicy({ preset: "guarded", role: "challenger" });
			expect(p.capabilities.filesystem).toBe("write");
			expect(p.capabilities.shell).toBe("readonly");
		});

		it("plan + judge: capabilities within judge ceilings", () => {
			const p = compilePolicy({ preset: "plan", role: "judge" });
			expect(p.capabilities.filesystem).toBe("read");
			expect(p.capabilities.shell).toBe("off");
			expect(p.interaction.approval).toBe("always");
		});
	});

	describe("legacy tool overrides", () => {
		it("attaches legacyToolOverrides when provided", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read", "Grep"], deny: ["WebFetch"] },
			});
			expect(p.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
			});
		});

		it("skips legacyToolOverrides when both are empty", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: [], deny: [] },
			});
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("skips legacyToolOverrides when undefined", () => {
			const p = compilePolicy({ preset: "guarded", role: "proposer" });
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("attaches when only allow is provided", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			expect(p.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(p.capabilities.legacyToolOverrides?.deny).toBeUndefined();
		});
	});

	describe("roleContract in output", () => {
		it("includes correct roleContract for judge", () => {
			const p = compilePolicy({ preset: "plan", role: "judge" });
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.semantics.factCheck).toBe("minimal");
			expect(p.roleContract.ceilings.shell).toBe("off");
		});
	});

	describe("immutability", () => {
		it("does not mutate DEFAULT_ROLE_CONTRACTS", () => {
			const before = JSON.stringify(DEFAULT_ROLE_CONTRACTS);
			compilePolicy({ preset: "dangerous", role: "judge" });
			compilePolicy({ preset: "research", role: "proposer" });
			expect(JSON.stringify(DEFAULT_ROLE_CONTRACTS)).toBe(before);
		});

		it("returned policy objects are independent", () => {
			const p1 = compilePolicy({ preset: "research", role: "proposer" });
			const p2 = compilePolicy({ preset: "research", role: "proposer" });
			expect(p1).toEqual(p2);
			expect(p1).not.toBe(p2);
			expect(p1.roleContract).not.toBe(p2.roleContract);
		});
	});
});
