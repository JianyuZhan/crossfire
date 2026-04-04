import { describe, expect, it } from "vitest";
import { resolveAllRoles } from "../../src/config/resolver.js";
import type { CrossfireConfig } from "../../src/config/schema.js";

const baseConfig: CrossfireConfig = {
	providerBindings: [
		{ name: "claude-main", adapter: "claude", model: "claude-sonnet" },
		{ name: "codex-main", adapter: "codex", model: "gpt-5-codex" },
	],
	roles: {
		proposer: { binding: "claude-main", preset: "guarded" },
		challenger: { binding: "codex-main", preset: "research" },
		judge: { binding: "claude-main", preset: "plan" },
	},
};

describe("resolveAllRoles", () => {
	it("resolves all roles from config with no CLI overrides", () => {
		const roles = resolveAllRoles(baseConfig, {});
		expect(roles.proposer.adapter).toBe("claude");
		expect(roles.proposer.model).toBe("claude-sonnet");
		expect(roles.proposer.preset).toEqual({
			value: "guarded",
			source: "config",
		});
		expect(roles.challenger.adapter).toBe("codex");
		expect(roles.challenger.preset).toEqual({
			value: "research",
			source: "config",
		});
		expect(roles.judge?.preset).toEqual({ value: "plan", source: "config" });
	});

	it("role-level model overrides binding model", () => {
		const config: CrossfireConfig = {
			...baseConfig,
			roles: {
				...baseConfig.roles,
				proposer: {
					binding: "claude-main",
					preset: "guarded",
					model: "claude-opus",
				},
			},
		};
		const roles = resolveAllRoles(config, {});
		expect(roles.proposer.model).toBe("claude-opus");
	});

	it("CLI preset overrides config preset", () => {
		const roles = resolveAllRoles(baseConfig, {
			cliGlobalPreset: "dangerous",
		});
		expect(roles.proposer.preset).toEqual({
			value: "dangerous",
			source: "cli-global",
		});
	});

	it("falls back to role default when config preset omitted", () => {
		const config: CrossfireConfig = {
			...baseConfig,
			roles: {
				proposer: { binding: "claude-main" },
				challenger: { binding: "codex-main" },
				judge: { binding: "claude-main" },
			},
		};
		const roles = resolveAllRoles(config, {});
		expect(roles.proposer.preset).toEqual({
			value: "guarded",
			source: "role-default",
		});
		expect(roles.judge?.preset).toEqual({
			value: "plan",
			source: "role-default",
		});
	});

	it("throws on invalid binding reference", () => {
		const config: CrossfireConfig = {
			...baseConfig,
			roles: {
				...baseConfig.roles,
				proposer: { binding: "nonexistent" },
			},
		};
		expect(() => resolveAllRoles(config, {})).toThrow(/binding.*nonexistent/i);
	});
});
