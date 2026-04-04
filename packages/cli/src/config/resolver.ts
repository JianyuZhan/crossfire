// packages/cli/src/config/resolver.ts
import type { PolicyPreset } from "@crossfire/adapter-core";
import type { PresetSource } from "./policy-resolution.js";
import { resolveRolePreset } from "./policy-resolution.js";
import type { CrossfireConfig } from "./schema.js";

export type AdapterType = "claude" | "codex" | "gemini";

export interface ResolvedRoleRuntimeConfig {
	role: "proposer" | "challenger" | "judge";
	adapter: AdapterType;
	bindingName: string;
	model?: string;
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	systemPrompt?: string;
	providerOptions?: Record<string, unknown>;
	mcpServers?: string[];
}

export interface ResolvedAllRoles {
	proposer: ResolvedRoleRuntimeConfig;
	challenger: ResolvedRoleRuntimeConfig;
	judge?: ResolvedRoleRuntimeConfig;
}

export interface CliPresetOverrides {
	cliGlobalPreset?: PolicyPreset;
	cliProposerPreset?: PolicyPreset;
	cliChallengerPreset?: PolicyPreset;
	cliJudgePreset?: PolicyPreset;
}

export function resolveAllRoles(
	config: CrossfireConfig,
	cliOverrides: CliPresetOverrides,
): ResolvedAllRoles {
	const bindingMap = new Map(config.providerBindings.map((b) => [b.name, b]));

	function resolveRole(
		roleName: "proposer" | "challenger" | "judge",
	): ResolvedRoleRuntimeConfig | undefined {
		const roleConfig = config.roles[roleName];
		if (!roleConfig) return undefined;

		const binding = bindingMap.get(roleConfig.binding);
		if (!binding) {
			throw new Error(
				`Role "${roleName}" references binding "${roleConfig.binding}" which does not exist. ` +
					`Available bindings: ${[...bindingMap.keys()].join(", ")}`,
			);
		}

		const cliRolePreset =
			roleName === "proposer"
				? cliOverrides.cliProposerPreset
				: roleName === "challenger"
					? cliOverrides.cliChallengerPreset
					: cliOverrides.cliJudgePreset;

		const preset = resolveRolePreset({
			role: roleName,
			configPreset: roleConfig.preset,
			cliRolePreset,
			cliGlobalPreset: cliOverrides.cliGlobalPreset,
		});

		return {
			role: roleName,
			adapter: binding.adapter,
			bindingName: binding.name,
			model: roleConfig.model ?? binding.model,
			preset: { value: preset.preset, source: preset.source },
			systemPrompt: roleConfig.systemPrompt,
			providerOptions: binding.providerOptions,
			mcpServers: binding.mcpServers,
		};
	}

	const proposer = resolveRole("proposer");
	const challenger = resolveRole("challenger");
	if (!proposer || !challenger) {
		throw new Error("proposer and challenger roles are required");
	}

	return {
		proposer,
		challenger,
		judge: resolveRole("judge"),
	};
}
