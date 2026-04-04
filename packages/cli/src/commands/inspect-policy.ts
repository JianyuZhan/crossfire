// packages/cli/src/commands/inspect-policy.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { buildInspectionContext } from "./inspection-context.js";
import { renderPolicyText } from "./inspection-renderers.js";
import { collectOptionValues } from "./preset-options.js";

export const inspectPolicyCommand = new Command("inspect-policy")
	.description("Inspect effective policy for each role before execution")
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
				"Error: --turn-preset is not supported by inspect-policy. " +
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
			console.log(JSON.stringify({ roles: filtered }, null, 2));
		} else {
			console.log(renderPolicyText(filtered));
		}
	});
