import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDebate } from "@crossfire/orchestrator";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { App } from "@crossfire/tui";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig } from "../config/loader.js";
import type {
	CliPresetOverrides,
	ResolvedRoleRuntimeConfig,
} from "../config/resolver.js";
import { resolveAllRoles } from "../config/resolver.js";
import { createAdapters } from "../wiring/create-adapters.js";
import { createBus } from "../wiring/create-bus.js";
import { createDefaultFactories } from "../wiring/create-factories.js";
import { createTui } from "../wiring/create-tui.js";
import { createLiveCommandHandler } from "../wiring/live-command-handler.js";
import {
	type PresetConfig,
	buildPresetConfig,
	collectOptionValues,
	toCliPresetOverrides,
} from "./preset-options.js";

function requirePositiveInt(value: string, label: string): number {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) {
		console.error(`Error: ${label} must be a positive integer`);
		process.exit(1);
	}
	return n;
}

function generateDebateId(): string {
	const now = new Date();
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("");
	const time = [
		String(now.getHours()).padStart(2, "0"),
		String(now.getMinutes()).padStart(2, "0"),
		String(now.getSeconds()).padStart(2, "0"),
	].join("");
	return `d-${date}-${time}`;
}

export const startCommand = new Command("start")
	.description("Start a new debate")
	.requiredOption("--config <path>", "Path to crossfire.json config file")
	.option(
		"--topic <text>",
		"Debate topic (mutually exclusive with --topic-file)",
	)
	.option(
		"--topic-file <path>",
		"File containing debate topic (mutually exclusive with --topic)",
	)
	.option(
		"--max-rounds <n>",
		"Maximum debate rounds before forced termination",
		"10",
	)
	.option(
		"--judge-every-n-rounds <n>",
		"Judge intervenes every N rounds (must be < max-rounds)",
		"3",
	)
	.option(
		"--convergence-threshold <n>",
		"Stance distance (0-1) below which debate auto-converges",
		"0.3",
	)
	.option("--output <dir>", "Output directory for debate logs")
	.option(
		"--preset <preset>",
		"Default policy preset: research, guarded, dangerous, or plan",
	)
	.option(
		"--proposer-preset <preset>",
		"Proposer policy preset: research, guarded, dangerous, or plan",
	)
	.option(
		"--challenger-preset <preset>",
		"Challenger policy preset: research, guarded, dangerous, or plan",
	)
	.option(
		"--judge-preset <preset>",
		"Judge policy preset: research, guarded, dangerous, or plan",
	)
	.option(
		"--turn-preset <turnId=preset>",
		"Per-turn preset override, repeatable (for example: p-1=plan)",
		collectOptionValues,
		[],
	)
	.option("--evidence-bar <bar>", "Evidence threshold: low, medium, or high")
	.option("--headless", "Run without TUI", false)
	.option("-v, --verbose", "Verbose output", false)
	.action(async (options) => {
		try {
			// Validate mutually exclusive topic options
			if (!options.topic && !options.topicFile) {
				console.error(
					"Error: Either --topic or --topic-file must be specified",
				);
				process.exit(1);
			}
			if (options.topic && options.topicFile) {
				console.error("Error: --topic and --topic-file are mutually exclusive");
				process.exit(1);
			}

			// Validate numeric options
			const maxRounds = requirePositiveInt(options.maxRounds, "--max-rounds");
			const convergenceThreshold = Number.parseFloat(
				options.convergenceThreshold,
			);
			if (
				!Number.isFinite(convergenceThreshold) ||
				convergenceThreshold < 0 ||
				convergenceThreshold > 1
			) {
				console.error(
					"Error: --convergence-threshold must be a number between 0 and 1",
				);
				process.exit(1);
			}

			// Load topic
			const topic =
				options.topic ?? readFileSync(options.topicFile, "utf-8").trim();

			// Validate judge-every-n-rounds
			const judgeEveryNRounds = requirePositiveInt(
				options.judgeEveryNRounds,
				"--judge-every-n-rounds",
			);
			if (judgeEveryNRounds >= maxRounds) {
				console.error(
					`Error: --judge-every-n-rounds (${judgeEveryNRounds}) must be less than --max-rounds (${maxRounds})`,
				);
				process.exit(1);
			}

			const factories = createDefaultFactories();

			// Build preset config from CLI flags
			const presetConfig = buildPresetConfig({
				preset: options.preset,
				proposerPreset: options.proposerPreset,
				challengerPreset: options.challengerPreset,
				judgePreset: options.judgePreset,
				turnPreset: options.turnPreset,
				evidenceBar: options.evidenceBar,
			});

			// Generate debate ID and output directory
			const debateId = generateDebateId();
			const outputDir = options.output ?? `run_output/${debateId}`;
			mkdirSync(outputDir, { recursive: true });

			// Load and resolve config
			const crossfireConfig = loadConfig(options.config);
			const cliOverrides: CliPresetOverrides =
				toCliPresetOverrides(presetConfig);
			const resolvedAllRoles = resolveAllRoles(crossfireConfig, cliOverrides, {
				configFilePath: options.config,
			});

			const config: DebateConfig = {
				topic,
				maxRounds,
				judgeEveryNRounds,
				convergenceThreshold,
				turnPresets: presetConfig?.turnPresets,
				proposerModel: resolvedAllRoles.proposer.model,
				challengerModel: resolvedAllRoles.challenger.model,
				judgeModel: resolvedAllRoles.judge?.model,
				proposerSystemPrompt: resolvedAllRoles.proposer.systemPrompt,
				challengerSystemPrompt: resolvedAllRoles.challenger.systemPrompt,
				judgeSystemPrompt: resolvedAllRoles.judge?.systemPrompt,
			};

			const summarizeRole = (r: ResolvedRoleRuntimeConfig) => ({
				binding: r.bindingName,
				adapter: r.adapter,
				model: r.model,
				preset: r.preset,
			});

			const initialIndex = {
				debateId,
				config,
				configFile: options.config,
				roles: {
					proposer: summarizeRole(resolvedAllRoles.proposer),
					challenger: summarizeRole(resolvedAllRoles.challenger),
					...(resolvedAllRoles.judge
						? { judge: summarizeRole(resolvedAllRoles.judge) }
						: {}),
				},
				versions: {
					crossfire: "0.1.0",
					nodeVersion: process.version,
				},
			};
			writeFileSync(
				join(outputDir, "index.json"),
				`${JSON.stringify(initialIndex, null, 2)}\n`,
			);

			if (options.verbose) {
				console.log("Configuration (from config file):");
				console.log(`  Config: ${options.config}`);
				console.log(`  Topic: ${topic}`);
				console.log(
					`  Proposer: ${resolvedAllRoles.proposer.bindingName} (${resolvedAllRoles.proposer.adapter}) preset=${resolvedAllRoles.proposer.preset.value}`,
				);
				console.log(
					`  Challenger: ${resolvedAllRoles.challenger.bindingName} (${resolvedAllRoles.challenger.adapter}) preset=${resolvedAllRoles.challenger.preset.value}`,
				);
				if (resolvedAllRoles.judge) {
					console.log(
						`  Judge: ${resolvedAllRoles.judge.bindingName} (${resolvedAllRoles.judge.adapter}) preset=${resolvedAllRoles.judge.preset.value}`,
					);
				}
				console.log(`  Output: ${outputDir}`);
			}

			const adapterBundle = await createAdapters(resolvedAllRoles, factories);
			const busBundle = createBus({ outputDir });
			const tuiBundle = createTui(busBundle.bus, options.headless);

			let inkInstance: { clear: () => void; unmount: () => void } | undefined;
			let userQuitResolve: (() => void) | undefined;
			const abortController = new AbortController();
			const triggerShutdown = () => {
				if (userQuitResolve) {
					userQuitResolve();
					return;
				}
				if (abortController.signal.aborted) {
					// Second attempt — force exit
					process.exit(1);
				}
				abortController.abort();
				busBundle.bus.push({
					kind: "debate.completed",
					reason: "user-interrupt",
					timestamp: Date.now(),
				});
			};
			if (tuiBundle) {
				inkInstance = render(
					React.createElement(App, {
						store: tuiBundle.store,
						source: tuiBundle.source,
						onCommand: createLiveCommandHandler({
							adapters: adapterBundle.adapters,
							bus: busBundle.bus,
							store: tuiBundle.store,
							triggerShutdown,
							getUserQuitHandler: () => userQuitResolve,
						}),
					}),
				);
			}

			process.on("SIGINT", triggerShutdown);
			try {
				const finalState = await runDebate(config, adapterBundle.adapters, {
					bus: busBundle.bus,
					debateId,
					outputDir,
					transcriptWriter: busBundle.transcriptWriter,
				});

				if (inkInstance) {
					// Debate complete — keep TUI interactive until user quits (q, /quit, Ctrl+C)
					await new Promise<void>((resolve) => {
						userQuitResolve = resolve;
					});
				} else {
					// Non-TUI mode (headless or fallback): always print completion info
					console.log("\nDebate completed!");
					console.log(`Reason: ${finalState.terminationReason}`);
					console.log(`Total rounds: ${finalState.currentRound}`);
					console.log(`Output saved to: ${outputDir}`);
				}
			} finally {
				process.off("SIGINT", triggerShutdown);
				tuiBundle?.store.dispose();
				inkInstance?.unmount();
				// Close persistence before adapters (adapters may hang on close)
				await busBundle.close();
				await adapterBundle.closeAll();
			}
		} catch (error) {
			console.error(
				"Error:",
				error instanceof Error ? error.message : String(error),
			);
			process.exit(1);
		}
	});
