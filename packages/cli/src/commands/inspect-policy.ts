// packages/cli/src/commands/inspect-policy.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { buildInspectionContext } from "./inspection-context.js";
import { renderPolicyText } from "./inspection-renderers.js";
import { buildPolicyInspectionReport } from "./inspection-reports.js";
import {
	buildInspectionCliOverrides,
	collectOptionValues,
} from "./preset-options.js";

export const inspectPolicyCommand = new Command("inspect-policy")
	.description("Inspect effective policy for each role before execution")
	.requiredOption("--config <path>", "Path to crossfire config file")
	.option("--format <format>", "Output format: text or json", "text")
	.option("--role <role>", "Filter to a single role")
	.option("--preset <preset>", "Global preset override")
	.option("--proposer-preset <preset>", "Proposer preset override")
	.option("--challenger-preset <preset>", "Challenger preset override")
	.option("--judge-preset <preset>", "Judge preset override")
	.option("--evidence-bar <bar>", "Evidence threshold: low, medium, or high")
	.option(
		"--turn-preset <turnId=preset>",
		"REJECTED: inspect commands do not accept turn-level overrides",
		collectOptionValues,
		[],
	)
	.action((options) => {
		try {
			const config = loadConfig(options.config);
			const cliOverrides = buildInspectionCliOverrides({
				preset: options.preset,
				proposerPreset: options.proposerPreset,
				challengerPreset: options.challengerPreset,
				judgePreset: options.judgePreset,
				evidenceBar: options.evidenceBar,
				turnPreset: options.turnPreset,
			});
			const contexts = buildInspectionContext(config, cliOverrides);

			const filtered = options.role
				? contexts.filter((c) => c.role === options.role)
				: contexts;

			if (options.format === "json") {
				console.log(
					JSON.stringify(buildPolicyInspectionReport(filtered), null, 2),
				);
			} else {
				console.log(renderPolicyText(filtered));
			}
		} catch (error) {
			console.error(
				error instanceof Error ? `Error: ${error.message}` : String(error),
			);
			process.exit(1);
		}
	});
