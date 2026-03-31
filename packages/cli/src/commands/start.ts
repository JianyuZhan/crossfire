import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDebate } from "@crossfire/orchestrator";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { App } from "@crossfire/tui";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadProfile } from "../profile/loader.js";
import {
	parsePromptTemplateSelection,
	resolvePromptTemplateFamily,
	resolveRolePrompt,
	selectPromptTemplateSelection,
} from "../profile/prompt-template.js";
import { resolveAdapterType, resolveRoles } from "../profile/resolver.js";
import { classifyPromptTemplateFamily } from "../profile/topic-template-classifier.js";
import { createAdapters } from "../wiring/create-adapters.js";
import { createBus } from "../wiring/create-bus.js";
import { createDefaultFactories } from "../wiring/create-factories.js";
import { createTui } from "../wiring/create-tui.js";
import { createLiveCommandHandler } from "../wiring/live-command-handler.js";
import {
	buildExecutionModeConfig,
	collectOptionValues,
} from "./execution-mode-options.js";

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
	.requiredOption("--proposer <profile>", "Proposer agent profile")
	.requiredOption("--challenger <profile>", "Challenger agent profile")
	.option(
		"--topic <text>",
		"Debate topic (mutually exclusive with --topic-file)",
	)
	.option(
		"--topic-file <path>",
		"File containing debate topic (mutually exclusive with --topic)",
	)
	.option(
		"--judge <profile>",
		"Judge agent profile (default: inferred from proposer)",
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
	.option("--model <model>", "Default model for all agents")
	.option("--proposer-model <model>", "Model override for proposer")
	.option("--challenger-model <model>", "Model override for challenger")
	.option("--judge-model <model>", "Model override for judge")
	.option(
		"--mode <mode>",
		"Debate default execution mode: research, guarded, or dangerous",
	)
	.option(
		"--proposer-mode <mode>",
		"Proposer baseline execution mode: research, guarded, or dangerous",
	)
	.option(
		"--challenger-mode <mode>",
		"Challenger baseline execution mode: research, guarded, or dangerous",
	)
	.option(
		"--turn-mode <turnId=mode>",
		"Per-turn execution mode override, repeatable (for example: p-1=plan)",
		collectOptionValues,
		[],
	)
	.option(
		"--template <family>",
		"Prompt template family: auto, general, or code",
	)
	.option(
		"--proposer-template <family>",
		"Proposer prompt template family: auto, general, or code",
	)
	.option(
		"--challenger-template <family>",
		"Challenger prompt template family: auto, general, or code",
	)
	.option(
		"--judge-template <family>",
		"Judge prompt template family: auto, general, or code",
	)
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
			const templateSelection = parsePromptTemplateSelection(
				options.template,
				"--template",
			);
			const proposerTemplateSelection = parsePromptTemplateSelection(
				options.proposerTemplate,
				"--proposer-template",
			);
			const challengerTemplateSelection = parsePromptTemplateSelection(
				options.challengerTemplate,
				"--challenger-template",
			);
			const judgeTemplateSelection = parsePromptTemplateSelection(
				options.judgeTemplate,
				"--judge-template",
			);

			// Load profiles
			const proposerProfile = loadProfile(options.proposer);
			const challengerProfile = loadProfile(options.challenger);

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

			// Resolve judge profile: infer from proposer adapter type if not specified
			const judgeName =
				options.judge ?? `${resolveAdapterType(proposerProfile.agent)}/judge`;
			if (!options.judge && options.verbose) {
				console.log(`  Judge profile inferred from proposer: ${judgeName}`);
			}
			const judgeProfile = loadProfile(judgeName);

			const factories = createDefaultFactories();
			const proposerSelection = selectPromptTemplateSelection({
				profile: proposerProfile,
				explicitSelection: proposerTemplateSelection,
				inheritedSelection: templateSelection,
			});
			const challengerSelection = selectPromptTemplateSelection({
				profile: challengerProfile,
				explicitSelection: challengerTemplateSelection,
				inheritedSelection: templateSelection,
			});
			const judgeSelection = selectPromptTemplateSelection({
				profile: judgeProfile,
				explicitSelection: judgeTemplateSelection,
				inheritedSelection: templateSelection,
			});
			const needsTemplateClassifier = [
				proposerSelection,
				challengerSelection,
				judgeSelection,
			].some((selection) => selection === "auto");

			// Start classifier early without awaiting (overlaps with sync work below)
			const classifierPromise = needsTemplateClassifier
				? classifyPromptTemplateFamily({
						topic,
						profile: judgeProfile,
						model: options.judgeModel ?? options.model,
						factories,
					})
				: undefined;

			// Build execution mode config (independent of classifier result)
			const executionModes = buildExecutionModeConfig({
				mode: options.mode,
				proposerMode: options.proposerMode,
				challengerMode: options.challengerMode,
				turnMode: options.turnMode,
			});

			// Generate debate ID and output directory (independent of classifier result)
			const debateId = generateDebateId();
			const outputDir = options.output ?? `run_output/${debateId}`;
			mkdirSync(outputDir, { recursive: true });

			// Await classifier result now (LLM call overlapped with sync work above)
			const autoTemplateFamily = classifierPromise
				? await classifierPromise
				: undefined;
			if (options.verbose && autoTemplateFamily) {
				console.log(
					`  Template classifier: ${autoTemplateFamily.family} (${autoTemplateFamily.source}, confidence ${autoTemplateFamily.confidence.toFixed(2)})`,
				);
				console.log(`    Reason: ${autoTemplateFamily.reason}`);
			}

			const proposerPrompt = resolveRolePrompt({
				role: "proposer",
				family: resolvePromptTemplateFamily(
					proposerSelection,
					autoTemplateFamily?.family ?? "general",
				),
			});
			const challengerPrompt = resolveRolePrompt({
				role: "challenger",
				family: resolvePromptTemplateFamily(
					challengerSelection,
					autoTemplateFamily?.family ?? "general",
				),
			});
			const judgePrompt = resolveRolePrompt({
				role: "judge",
				family: resolvePromptTemplateFamily(
					judgeSelection,
					autoTemplateFamily?.family ?? "general",
				),
			});

			// Resolve roles
			const roles = resolveRoles({
				proposer: {
					profile: proposerProfile,
					cliModel: options.proposerModel ?? options.model,
					systemPrompt: proposerPrompt.systemPrompt,
					promptTemplateFamily: proposerPrompt.promptTemplateFamily,
				},
				challenger: {
					profile: challengerProfile,
					cliModel: options.challengerModel ?? options.model,
					systemPrompt: challengerPrompt.systemPrompt,
					promptTemplateFamily: challengerPrompt.promptTemplateFamily,
				},
				judge: {
					profile: judgeProfile,
					cliModel: options.judgeModel ?? options.model,
					systemPrompt: judgePrompt.systemPrompt,
					promptTemplateFamily: judgePrompt.promptTemplateFamily,
				},
			});

			// Build debate config
			const config: DebateConfig = {
				topic,
				maxRounds,
				judgeEveryNRounds,
				convergenceThreshold,
				executionModes,
				promptTemplates: {
					defaultSelection: templateSelection,
					proposer: proposerPrompt.promptTemplateFamily,
					challenger: challengerPrompt.promptTemplateFamily,
					judge: judgePrompt.promptTemplateFamily,
				},
				proposerModel: roles.proposer.model,
				challengerModel: roles.challenger.model,
				judgeModel: roles.judge?.model,
				proposerSystemPrompt: roles.proposer.systemPrompt,
				challengerSystemPrompt: roles.challenger.systemPrompt,
				judgeSystemPrompt: roles.judge?.systemPrompt,
			};

			// Write initial index.json with profile mapping (EventStore merges runtime data on close)
			const initialIndex = {
				debateId,
				config,
				profiles: {
					proposer: {
						name: proposerProfile.name,
						agent: proposerProfile.agent,
						model: roles.proposer.model,
						promptTemplateFamily: roles.proposer.promptTemplateFamily,
					},
					challenger: {
						name: challengerProfile.name,
						agent: challengerProfile.agent,
						model: roles.challenger.model,
						promptTemplateFamily: roles.challenger.promptTemplateFamily,
					},
					...(roles.judge
						? {
								judge: {
									name: judgeProfile.name,
									agent: judgeProfile.agent,
									model: roles.judge.model,
									promptTemplateFamily: roles.judge.promptTemplateFamily,
								},
							}
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
				console.log("Configuration:");
				console.log(`  Topic: ${topic}`);
				console.log(
					`  Proposer: ${proposerProfile.name} (${roles.proposer.adapterType})`,
				);
				if (roles.proposer.promptTemplateFamily) {
					console.log(
						`    Prompt template: ${roles.proposer.promptTemplateFamily}`,
					);
				}
				console.log(
					`  Challenger: ${challengerProfile.name} (${roles.challenger.adapterType})`,
				);
				if (roles.challenger.promptTemplateFamily) {
					console.log(
						`    Prompt template: ${roles.challenger.promptTemplateFamily}`,
					);
				}
				if (roles.judge) {
					console.log(
						`  Judge: ${judgeProfile.name} (${roles.judge.adapterType})`,
					);
					if (roles.judge.promptTemplateFamily) {
						console.log(
							`    Prompt template: ${roles.judge.promptTemplateFamily}`,
						);
					}
				}
				console.log(`  Output: ${outputDir}`);
			}

			const adapterBundle = await createAdapters(
				roles,
				factories,
				executionModes,
			);
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
