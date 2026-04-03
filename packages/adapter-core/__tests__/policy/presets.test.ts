// packages/adapter-core/__tests__/policy/presets.test.ts
import { describe, expect, it } from "vitest";
import { PRESET_EXPANSIONS } from "../../src/policy/presets.js";

describe("PRESET_EXPANSIONS", () => {
	it("research: read-only, search, shell off, on-risk, maxTurns 12", () => {
		const r = PRESET_EXPANSIONS.research;
		expect(r.capabilities).toEqual({
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		});
		expect(r.interaction.approval).toBe("on-risk");
		expect(r.interaction.limits?.maxTurns).toBe(12);
	});

	it("guarded: write, search, readonly shell, on-risk, no limits", () => {
		const g = PRESET_EXPANSIONS.guarded;
		expect(g.capabilities).toEqual({
			filesystem: "write",
			network: "search",
			shell: "readonly",
			subagents: "off",
		});
		expect(g.interaction.approval).toBe("on-risk");
		expect(g.interaction.limits).toBeUndefined();
	});

	it("dangerous: full access, never ask", () => {
		const d = PRESET_EXPANSIONS.dangerous;
		expect(d.capabilities).toEqual({
			filesystem: "write",
			network: "full",
			shell: "exec",
			subagents: "on",
		});
		expect(d.interaction.approval).toBe("never");
	});

	it("plan: same capabilities as research, approval always", () => {
		const p = PRESET_EXPANSIONS.plan;
		expect(p.capabilities).toEqual(PRESET_EXPANSIONS.research.capabilities);
		expect(p.interaction.approval).toBe("always");
		expect(p.interaction.limits).toBeUndefined();
	});

	it("no preset contains provider-specific fields", () => {
		for (const [, expansion] of Object.entries(PRESET_EXPANSIONS)) {
			const keys = [
				...Object.keys(expansion.capabilities),
				...Object.keys(expansion.interaction),
			];
			expect(keys).not.toContain("permissionMode");
			expect(keys).not.toContain("approvalPolicy");
			expect(keys).not.toContain("sandboxPolicy");
			expect(keys).not.toContain("approvalMode");
		}
	});

	it("constants are frozen", () => {
		expect(Object.isFrozen(PRESET_EXPANSIONS)).toBe(true);
	});
});
