import { describe, expect, it } from "vitest";
import {
	type RoleInspectionContext,
	buildInspectionContext,
} from "../../src/commands/inspection-context.js";
import {
	renderPolicyText,
	renderToolsText,
} from "../../src/commands/inspection-renderers.js";
import { buildToolInspectionReport } from "../../src/commands/inspection-reports.js";
import type { CrossfireConfig } from "../../src/config/schema.js";

const testConfig: CrossfireConfig = {
	providerBindings: [
		{ name: "claude-test", adapter: "claude", model: "claude-sonnet" },
	],
	roles: {
		proposer: { binding: "claude-test", preset: "guarded" },
		challenger: { binding: "claude-test", preset: "research" },
	},
};

function assertSuccess(ctx: RoleInspectionContext) {
	if (ctx.error)
		throw new Error(`Unexpected error for ${ctx.role}: ${ctx.error.message}`);
	return ctx;
}

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

describe("inspect-tools output contract", () => {
	it("toolView contains expected fields per ToolInspectionRecord", () => {
		const context = buildInspectionContext(testConfig, {});
		const proposer = assertSuccess(findContext(context, "proposer"));
		for (const tool of proposer.observation.toolView) {
			expect(tool).toHaveProperty("name");
			expect(tool).toHaveProperty("source");
			expect(tool).toHaveProperty("status");
			expect(tool).toHaveProperty("reason");
		}
	});

	it("capabilityEffects present for each modeled dimension", () => {
		const context = buildInspectionContext(testConfig, {});
		const proposer = assertSuccess(findContext(context, "proposer"));
		const fields = proposer.observation.capabilityEffects.map((e) => e.field);
		expect(fields).toContain("capabilities.filesystem");
		expect(fields).toContain("capabilities.shell");
	});

	it("completeness is reported per role", () => {
		const context = buildInspectionContext(testConfig, {});
		for (const ctx of context) {
			const success = assertSuccess(ctx);
			expect(["full", "partial", "minimal"]).toContain(
				success.observation.completeness,
			);
		}
	});

	it("research preset blocks Bash but allows Read", () => {
		const context = buildInspectionContext(testConfig, {});
		const challenger = assertSuccess(findContext(context, "challenger"));
		const bash = challenger.observation.toolView.find((t) => t.name === "Bash");
		const read = challenger.observation.toolView.find((t) => t.name === "Read");
		expect(bash?.status).toBe("blocked");
		expect(read?.status).toBe("allowed");
	});

	it("configured MCP attachments appear as unknown MCP tool records", () => {
		const config: CrossfireConfig = {
			mcpServers: {
				github: {
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-github"],
				},
			},
			providerBindings: [
				{
					name: "claude-test",
					adapter: "claude",
					model: "claude-sonnet",
					mcpServers: ["github"],
				},
			],
			roles: {
				proposer: { binding: "claude-test", preset: "guarded" },
				challenger: { binding: "claude-test", preset: "research" },
			},
		};
		const context = buildInspectionContext(config, {});
		const report = buildToolInspectionReport(context);
		const proposer = report.roles.find((r) => r.role === "proposer");
		const github = proposer?.tools.find((t) => t.name === "github");
		expect(github?.source).toBe("mcp");
		expect(github?.status).toBe("unknown");
	});

	it("builds tool JSON report without leaking internal observation objects", () => {
		const context = buildInspectionContext(testConfig, {});
		const report = buildToolInspectionReport(context);
		const proposer = report.roles.find((r) => r.role === "proposer");
		expect(proposer).toBeDefined();
		expect(proposer).toHaveProperty("tools");
		expect(proposer).toHaveProperty("capabilityEffects");
		expect(proposer).not.toHaveProperty("observation");
	});
});

describe("text output contract", () => {
	it("renderPolicyText: summary line appears before detail sections", () => {
		const context = buildInspectionContext(testConfig, {});
		const output = renderPolicyText(context);
		const lines = output.split("\n");
		const proposerHeader = lines.findIndex(
			(l) => l.includes("proposer") && l.includes("claude"),
		);
		const clampHeader = lines.findIndex((l) => l.includes("Clamp"));
		const warningHeader = lines.findIndex((l) => l.includes("Warning"));
		if (clampHeader !== -1) expect(proposerHeader).toBeLessThan(clampHeader);
		if (warningHeader !== -1)
			expect(proposerHeader).toBeLessThan(warningHeader);
	});

	it("renderPolicyText: preset source is displayed", () => {
		const context = buildInspectionContext(testConfig, {});
		const output = renderPolicyText(context);
		expect(output).toContain("config");
		expect(output).toContain("guarded");
	});

	it("renderToolsText: completeness is displayed per role", () => {
		const context = buildInspectionContext(testConfig, {});
		const output = renderToolsText(context);
		expect(output).toContain("partial");
	});

	it("renderToolsText: tool status indicators present", () => {
		const context = buildInspectionContext(testConfig, {});
		const output = renderToolsText(context);
		expect(output).toContain("Bash");
		expect(output).toContain("blocked");
	});

	it("renderPolicyText: error roles render error message, not crash", () => {
		const errorContext: RoleInspectionContext[] = [
			{
				role: "proposer",
				adapter: "claude",
				preset: { value: "guarded", source: "config" },
				error: { message: "adapter init failed" },
			},
		];
		const output = renderPolicyText(errorContext);
		expect(output).toContain("ERROR");
		expect(output).toContain("adapter init failed");
	});
});
