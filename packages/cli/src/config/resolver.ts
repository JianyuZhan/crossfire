// packages/cli/src/config/resolver.ts
import type {
	ApprovalLevel,
	EvidenceBar,
	PolicyPreset,
} from "@crossfire/adapter-core";
import type {
	EvidenceSource,
	ResolvedEvidence,
} from "./evidence-resolution.js";
import { resolveRoleEvidence } from "./evidence-resolution.js";
import type { PresetSource } from "./policy-resolution.js";
import { resolveRolePreset } from "./policy-resolution.js";
import type { CrossfireConfig, McpServerConfig } from "./schema.js";
import { resolveTemplate } from "./template-resolution.js";

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
	evidence: ResolvedEvidence;
	interactionOverrides?: {
		approval?: ApprovalLevel;
		limits?: { maxTurns?: number };
	};
	templateName?: string;
	templateBasePreset?: string;
	systemPrompt?: string;
	providerOptions?: Record<string, unknown>;
	mcpServers?: Record<string, McpServerConfig>;
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
	cliEvidenceBar?: EvidenceBar;
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

		// Resolve template if referenced
		const template = roleConfig.template
			? resolveTemplate(roleConfig.template, config.templates)
			: undefined;

		if (roleConfig.template && !template) {
			throw new Error(
				`Role "${roleName}" references template "${roleConfig.template}" which does not exist.`,
			);
		}

		const cliRolePreset =
			roleName === "proposer"
				? cliOverrides.cliProposerPreset
				: roleName === "challenger"
					? cliOverrides.cliChallengerPreset
					: cliOverrides.cliJudgePreset;

		// Template basePreset takes priority over role config preset
		const configOrTemplatePreset = template?.basePreset ?? roleConfig.preset;

		const preset = resolveRolePreset({
			role: roleName,
			configPreset: configOrTemplatePreset,
			cliRolePreset,
			cliGlobalPreset: cliOverrides.cliGlobalPreset,
		});

		// Resolve evidence with independent chain
		const evidence = resolveRoleEvidence({
			role: roleName,
			cliEvidenceBar: cliOverrides.cliEvidenceBar,
			configEvidence: roleConfig.evidence,
			templateEvidence: template?.overrides?.evidence,
			templateName: template?.name,
		});

		// Extract interaction overrides from template
		const interactionOverrides = template?.overrides?.interaction
			? {
					...(template.overrides.interaction.approval !== undefined
						? { approval: template.overrides.interaction.approval }
						: {}),
					...(template.overrides.interaction.limits
						? { limits: template.overrides.interaction.limits }
						: {}),
				}
			: undefined;

		const resolvedMcpServers = binding.mcpServers
			? Object.fromEntries(
					binding.mcpServers.map((name) => {
						const server = config.mcpServers?.[name];
						if (!server) {
							throw new Error(
								`Provider binding "${binding.name}" references MCP server "${name}" which does not exist.`,
							);
						}
						return [name, server];
					}),
				)
			: undefined;

		return {
			role: roleName,
			adapter: binding.adapter,
			bindingName: binding.name,
			model: roleConfig.model ?? binding.model,
			preset: { value: preset.preset, source: preset.source },
			evidence,
			interactionOverrides,
			templateName: template?.name,
			templateBasePreset: template?.basePreset,
			systemPrompt: roleConfig.systemPrompt,
			providerOptions: binding.providerOptions,
			mcpServers: resolvedMcpServers,
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
