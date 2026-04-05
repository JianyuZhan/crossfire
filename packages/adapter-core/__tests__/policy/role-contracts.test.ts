// packages/adapter-core/__tests__/policy/role-contracts.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";

describe("DEFAULT_ROLE_CONTRACTS", () => {
	it("proposer has no capability ceilings", () => {
		expect(DEFAULT_ROLE_CONTRACTS.proposer.ceilings).toEqual({});
	});

	it("challenger has no capability ceilings", () => {
		expect(DEFAULT_ROLE_CONTRACTS.challenger.ceilings).toEqual({});
	});

	it("judge has strict ceilings", () => {
		const j = DEFAULT_ROLE_CONTRACTS.judge;
		expect(j.ceilings).toEqual({
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		});
	});

	it("proposer may introduce new proposals", () => {
		expect(
			DEFAULT_ROLE_CONTRACTS.proposer.semantics.mayIntroduceNewProposal,
		).toBe(true);
	});

	it("challenger may NOT introduce new proposals", () => {
		expect(
			DEFAULT_ROLE_CONTRACTS.challenger.semantics.mayIntroduceNewProposal,
		).toBe(false);
	});

	it("judge exploration is forbidden", () => {
		expect(DEFAULT_ROLE_CONTRACTS.judge.semantics.exploration).toBe(
			"forbidden",
		);
	});

	it("judge factCheck is minimal", () => {
		expect(DEFAULT_ROLE_CONTRACTS.judge.semantics.factCheck).toBe("minimal");
	});

	it("challenger evidenceDefaults.bar is high", () => {
		expect(DEFAULT_ROLE_CONTRACTS.challenger.evidenceDefaults.bar).toBe("high");
	});

	it("constants are frozen and cannot be mutated", () => {
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge.semantics)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge.ceilings)).toBe(true);
	});
});
