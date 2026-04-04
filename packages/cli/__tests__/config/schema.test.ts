import { describe, expect, it } from "vitest";
import {
	type CrossfireConfig,
	CrossfireConfigSchema,
} from "../../src/config/schema.js";

describe("CrossfireConfigSchema", () => {
	const validConfig: CrossfireConfig = {
		providerBindings: [
			{ name: "claude-default", adapter: "claude", model: "claude-sonnet" },
		],
		roles: {
			proposer: { binding: "claude-default", preset: "guarded" },
			challenger: { binding: "claude-default", preset: "research" },
			judge: { binding: "claude-default", preset: "plan" },
		},
	};

	it("accepts a valid minimal config", () => {
		const result = CrossfireConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it("accepts config with mcpServers registry", () => {
		const config = {
			...validConfig,
			mcpServers: {
				github: { command: "npx", args: ["-y", "mcp-github"] },
			},
			providerBindings: [
				{
					name: "claude-default",
					adapter: "claude",
					mcpServers: ["github"],
				},
			],
		};
		const result = CrossfireConfigSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	it("rejects unknown adapter type", () => {
		const config = {
			...validConfig,
			providerBindings: [{ name: "bad", adapter: "unknown" }],
		};
		const result = CrossfireConfigSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it("rejects unknown preset value", () => {
		const config = {
			...validConfig,
			roles: {
				...validConfig.roles,
				proposer: { binding: "claude-default", preset: "invalid" },
			},
		};
		const result = CrossfireConfigSchema.safeParse(config);
		expect(result.success).toBe(false);
	});

	it("allows judge to be omitted", () => {
		const config = {
			providerBindings: validConfig.providerBindings,
			roles: {
				proposer: validConfig.roles.proposer,
				challenger: validConfig.roles.challenger,
			},
		};
		const result = CrossfireConfigSchema.safeParse(config);
		expect(result.success).toBe(true);
	});

	it("allows preset to be omitted (default rule applies)", () => {
		const config = {
			...validConfig,
			roles: {
				...validConfig.roles,
				proposer: { binding: "claude-default" },
			},
		};
		const result = CrossfireConfigSchema.safeParse(config);
		expect(result.success).toBe(true);
	});
});
