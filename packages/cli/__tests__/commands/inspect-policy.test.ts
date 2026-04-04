import { describe, expect, it } from "vitest";
import { buildInspectionContext } from "../../src/commands/inspection-context.js";
import type { CrossfireConfig } from "../../src/config/schema.js";

const testConfig: CrossfireConfig = {
	providerBindings: [
		{ name: "claude-test", adapter: "claude", model: "claude-sonnet" },
	],
	roles: {
		proposer: { binding: "claude-test", preset: "guarded" },
		challenger: { binding: "claude-test", preset: "research" },
		judge: { binding: "claude-test", preset: "plan" },
	},
};

describe("buildInspectionContext", () => {
	it("produces inspection for all roles", () => {
		const context = buildInspectionContext(testConfig, {});
		expect(context).toHaveLength(3);
		const roles = context.map((c) => c.role);
		expect(roles).toContain("proposer");
		expect(roles).toContain("challenger");
		expect(roles).toContain("judge");
	});

	it("includes preset source and clamp notes", () => {
		const context = buildInspectionContext(testConfig, {});
		const proposer = context.find((c) => c.role === "proposer")!;
		expect(proposer.error).toBeUndefined();
		expect(proposer.preset.source).toBe("config");
		expect(proposer.preset.value).toBe("guarded");
		if (!proposer.error) {
			expect(Array.isArray(proposer.clamps)).toBe(true);
		}
	});

	it("judge has clamp notes when using dangerous preset", () => {
		const config: CrossfireConfig = {
			...testConfig,
			roles: {
				...testConfig.roles,
				judge: { binding: "claude-test", preset: "dangerous" },
			},
		};
		const context = buildInspectionContext(config, {});
		const judge = context.find((c) => c.role === "judge")!;
		expect(judge.error).toBeUndefined();
		if (!judge.error) {
			expect(judge.clamps.length).toBeGreaterThan(0);
			expect(judge.clamps[0].reason).toBe("role_ceiling");
		}
	});

	it("includes adapter observation result", () => {
		const context = buildInspectionContext(testConfig, {});
		const proposer = context.find((c) => c.role === "proposer")!;
		expect(proposer.error).toBeUndefined();
		if (!proposer.error) {
			expect(proposer.observation).toBeDefined();
			expect(proposer.observation.completeness).toBe("partial");
		}
	});

	it("per-role failure isolation: mixed adapters all resolve", () => {
		const mixedConfig: CrossfireConfig = {
			providerBindings: [
				{ name: "claude-test", adapter: "claude", model: "claude-sonnet" },
				{ name: "codex-test", adapter: "codex", model: "gpt-5-codex" },
			],
			roles: {
				proposer: { binding: "claude-test", preset: "guarded" },
				challenger: { binding: "codex-test", preset: "guarded" },
				judge: { binding: "claude-test", preset: "plan" },
			},
		};
		const context = buildInspectionContext(mixedConfig, {});
		expect(context).toHaveLength(3);

		const proposer = context.find((c) => c.role === "proposer")!;
		const challenger = context.find((c) => c.role === "challenger")!;
		const judge = context.find((c) => c.role === "judge")!;

		expect(proposer.error).toBeUndefined();
		expect(challenger.error).toBeUndefined();
		expect(judge.error).toBeUndefined();

		if (!proposer.error) expect(proposer.observation).toBeDefined();
		if (!challenger.error) expect(challenger.observation).toBeDefined();
		if (!judge.error) expect(judge.observation).toBeDefined();
	});
});
