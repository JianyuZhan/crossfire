import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAllRoles } from "../../src/config/resolver.js";
import type { CrossfireConfig } from "../../src/config/schema.js";

const baseConfig: CrossfireConfig = {
	mcpServers: {
		github: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-github"],
		},
	},
	providerBindings: [
		{
			name: "claude-main",
			adapter: "claude",
			model: "claude-sonnet",
			mcpServers: ["github"],
		},
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
		expect(roles.proposer.mcpServers).toEqual({
			github: {
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-github"],
			},
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

	it("supports multiple bindings for the same adapter with different models", () => {
		const config: CrossfireConfig = {
			...baseConfig,
			providerBindings: [
				{
					name: "claude-fast",
					adapter: "claude",
					model: "claude-sonnet",
				},
				{
					name: "claude-deep",
					adapter: "claude",
					model: "claude-opus",
				},
				{
					name: "codex-main",
					adapter: "codex",
					model: "gpt-5.4",
				},
			],
			roles: {
				proposer: { binding: "claude-fast" },
				challenger: { binding: "claude-deep" },
				judge: { binding: "codex-main" },
			},
		};

		const roles = resolveAllRoles(config, {});
		expect(roles.proposer.adapter).toBe("claude");
		expect(roles.proposer.model).toBe("claude-sonnet");
		expect(roles.challenger.adapter).toBe("claude");
		expect(roles.challenger.model).toBe("claude-opus");
		expect(roles.judge?.adapter).toBe("codex");
	});

	it("loads systemPromptFile relative to the config file path", () => {
		const configDir = mkdtempSync(join(tmpdir(), "crossfire-config-"));
		const promptsDir = join(configDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		writeFileSync(
			join(promptsDir, "proposer.md"),
			"Prompt loaded from file.\n",
		);

		const config: CrossfireConfig = {
			providerBindings: [
				{ name: "b1", adapter: "claude", model: "claude-sonnet" },
			],
			roles: {
				proposer: {
					binding: "b1",
					systemPromptFile: "prompts/proposer.md",
				},
				challenger: { binding: "b1" },
			},
		};

		const roles = resolveAllRoles(
			config,
			{},
			{
				configFilePath: join(configDir, "crossfire.json"),
			},
		);
		expect(roles.proposer.systemPrompt).toBe("Prompt loaded from file.");
	});
});
