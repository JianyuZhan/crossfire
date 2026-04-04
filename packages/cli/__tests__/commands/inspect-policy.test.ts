import { describe, expect, it } from "vitest";
import { buildInspectionContext } from "../../src/commands/inspection-context.js";
import { buildPolicyInspectionReport } from "../../src/commands/inspection-reports.js";
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

function findContext(
	contexts: ReturnType<typeof buildInspectionContext>,
	role: "proposer" | "challenger" | "judge",
) {
	const context = contexts.find((entry) => entry.role === role);
	if (!context) {
		throw new Error(`Missing inspection context for ${role}`);
	}
	return context;
}

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
		const proposer = findContext(context, "proposer");
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
		const judge = findContext(context, "judge");
		expect(judge.error).toBeUndefined();
		if (!judge.error) {
			expect(judge.clamps.length).toBeGreaterThan(0);
			expect(judge.clamps[0].reason).toBe("role_ceiling");
		}
	});

	it("includes adapter observation result", () => {
		const context = buildInspectionContext(testConfig, {});
		const proposer = findContext(context, "proposer");
		expect(proposer.error).toBeUndefined();
		if (!proposer.error) {
			expect(proposer.observation).toBeDefined();
			expect(proposer.observation.completeness).toBe("partial");
		}
	});

	it("builds policy JSON report with spec-defined top-level fields", () => {
		const context = buildInspectionContext(testConfig, {});
		const report = buildPolicyInspectionReport(context);
		const proposer = report.roles.find((r) => r.role === "proposer");
		expect(proposer).toBeDefined();
		expect(proposer).toHaveProperty("resolvedPolicy");
		expect(proposer).toHaveProperty("clamps");
		expect(proposer).toHaveProperty("translation");
		expect(proposer).toHaveProperty("warnings");
		expect(proposer).not.toHaveProperty("observation");
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

		const proposer = findContext(context, "proposer");
		const challenger = findContext(context, "challenger");
		const judge = findContext(context, "judge");

		expect(proposer.error).toBeUndefined();
		expect(challenger.error).toBeUndefined();
		expect(judge.error).toBeUndefined();

		if (!proposer.error) expect(proposer.observation).toBeDefined();
		if (!challenger.error) expect(challenger.observation).toBeDefined();
		if (!judge.error) expect(judge.observation).toBeDefined();
	});
});
