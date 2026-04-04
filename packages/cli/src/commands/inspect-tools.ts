// packages/cli/src/commands/inspect-tools.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { buildInspectionContext } from "./inspection-context.js";
import { renderToolsText } from "./inspection-renderers.js";
import { collectOptionValues } from "./preset-options.js";

export const inspectToolsCommand = new Command("inspect-tools")
	.description("Inspect effective tool view for each role before execution")
	.requiredOption("--config <path>", "Path to crossfire config file")
	.option("--format <format>", "Output format: text or json", "text")
	.option("--role <role>", "Filter to a single role")
	.option("--preset <preset>", "Global preset override")
	.option("--proposer-preset <preset>", "Proposer preset override")
	.option("--challenger-preset <preset>", "Challenger preset override")
	.option("--judge-preset <preset>", "Judge preset override")
	.option(
		"--turn-preset <turnId=preset>",
		"REJECTED: inspect commands do not accept turn-level overrides",
		collectOptionValues,
		[],
	)
	.action((options) => {
		if (options.turnPreset?.length > 0) {
			console.error(
				"Error: --turn-preset is not supported by inspect-tools. " +
					"Inspection shows baseline role-level policy, not per-turn views.",
			);
			process.exit(1);
		}

		const config = loadConfig(options.config);
		const contexts = buildInspectionContext(config, {
			cliGlobalPreset: options.preset,
			cliProposerPreset: options.proposerPreset,
			cliChallengerPreset: options.challengerPreset,
			cliJudgePreset: options.judgePreset,
		});

		const filtered = options.role
			? contexts.filter((c) => c.role === options.role)
			: contexts;

		if (options.format === "json") {
			const report = {
				roles: filtered.map((ctx) => {
					if (ctx.error) {
						return {
							role: ctx.role,
							adapter: ctx.adapter,
							preset: ctx.preset,
							tools: [],
							capabilityEffects: [],
							completeness: "minimal" as const,
							warnings: [],
							error: ctx.error,
						};
					}
					return {
						role: ctx.role,
						adapter: ctx.adapter,
						preset: ctx.preset,
						tools: ctx.observation.toolView,
						capabilityEffects: ctx.observation.capabilityEffects,
						completeness: ctx.observation.completeness,
						warnings: ctx.observation.warnings,
					};
				}),
			};
			console.log(JSON.stringify(report, null, 2));
		} else {
			console.log(renderToolsText(filtered));
		}
	});
