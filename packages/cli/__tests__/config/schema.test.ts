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

	describe("templates", () => {
		const MINIMAL_CONFIG = {
			providerBindings: [{ name: "b1", adapter: "claude" as const }],
			roles: {
				proposer: { binding: "b1" },
				challenger: { binding: "b1" },
			},
		};

		it("accepts config without templates", () => {
			const result = CrossfireConfigSchema.safeParse(MINIMAL_CONFIG);
			expect(result.success).toBe(true);
		});

		it("accepts valid template with basePreset only", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "strict", basePreset: "guarded" }],
			});
			expect(result.success).toBe(true);
		});

		it("accepts valid template with evidence override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "strict-evidence",
						basePreset: "guarded",
						overrides: { evidence: { bar: "high" } },
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("rejects template with invalid evidence bar", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "bad",
						overrides: { evidence: { bar: "extreme" } },
					},
				],
			});
			expect(result.success).toBe(false);
		});

		it("rejects duplicate template names", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{ name: "t1", basePreset: "guarded" },
					{ name: "t1", basePreset: "research" },
				],
			});
			expect(result.success).toBe(false);
		});

		it("rejects template with invalid basePreset", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "bad", basePreset: "invalid" }],
			});
			expect(result.success).toBe(false);
		});

		it("accepts template with interaction override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "cautious",
						basePreset: "guarded",
						overrides: {
							interaction: { approval: "always", limits: { maxTurns: 5 } },
						},
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("rejects template with invalid approval level", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "bad",
						overrides: { interaction: { approval: "invalid" } },
					},
				],
			});
			expect(result.success).toBe(false);
		});

		it("accepts template with both evidence and interaction overrides", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "full",
						basePreset: "research",
						overrides: {
							evidence: { bar: "high" },
							interaction: { approval: "on-risk" },
						},
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("accepts template with no basePreset (uses role default)", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{ name: "ev-only", overrides: { evidence: { bar: "low" } } },
				],
			});
			expect(result.success).toBe(true);
		});
	});

	describe("role evidence field", () => {
		const MINIMAL_CONFIG = {
			providerBindings: [{ name: "b1", adapter: "claude" as const }],
			roles: {
				proposer: { binding: "b1" },
				challenger: { binding: "b1" },
			},
		};

		it("accepts role with evidence override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				roles: {
					proposer: { binding: "b1", evidence: { bar: "high" } },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(true);
		});

		it("rejects role with invalid evidence bar", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				roles: {
					proposer: { binding: "b1", evidence: { bar: "extreme" } },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(false);
		});
	});

	describe("role template field", () => {
		const MINIMAL_CONFIG = {
			providerBindings: [{ name: "b1", adapter: "claude" as const }],
			roles: {
				proposer: { binding: "b1" },
				challenger: { binding: "b1" },
			},
		};

		it("accepts role with template reference", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "strict", basePreset: "guarded" }],
				roles: {
					proposer: { binding: "b1", template: "strict" },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(true);
		});
	});
});
