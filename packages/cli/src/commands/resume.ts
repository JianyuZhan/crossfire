import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DebateEventBus, EventStore, runDebate } from "@crossfire/orchestrator";
import { projectState } from "@crossfire/orchestrator-core";
import { App } from "@crossfire/tui";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadProfile } from "../profile/loader.js";
import { resolveRoles } from "../profile/resolver.js";
import { createAdapters } from "../wiring/create-adapters.js";
import { createBus } from "../wiring/create-bus.js";
import { createDefaultFactories } from "../wiring/create-factories.js";
import { createTui } from "../wiring/create-tui.js";

export const resumeCommand = new Command("resume")
	.description("Resume an existing debate")
	.argument("<output-dir>", "Output directory containing the debate")
	.option("--proposer <profile>", "Override proposer profile")
	.option("--challenger <profile>", "Override challenger profile")
	.option("--judge <profile>", "Override judge profile")
	.option("--headless", "Run without TUI", false)
	.action(async (outputDir: string, options) => {
		try {
			const indexPath = join(outputDir, "index.json");
			const meta = JSON.parse(readFileSync(indexPath, "utf-8"));

			if (!meta.config) {
				console.error("Error: index.json missing config field");
				process.exit(1);
			}

			const config = meta.config;
			const debateId = meta.debateId;

			// Load existing events
			const events = EventStore.loadSegments(outputDir);
			const currentState = projectState(events);

			if (currentState.phase === "completed") {
				console.log("Debate already completed.");
				console.log(`Reason: ${currentState.terminationReason}`);
				console.log(`Total rounds: ${currentState.currentRound}`);
				console.log("Use `crossfire replay` to review the debate.");
				process.exit(0);
			}

			// Load profiles (CLI overrides or from index.json)
			const proposerProfile = loadProfile(
				options.proposer ?? meta.profiles.proposer.name,
			);
			const challengerProfile = loadProfile(
				options.challenger ?? meta.profiles.challenger.name,
			);

			let judgeProfile: ReturnType<typeof loadProfile> | "none" = "none";
			if (meta.profiles.judge) {
				judgeProfile = loadProfile(options.judge ?? meta.profiles.judge.name);
			}

			const roles = resolveRoles({
				proposer: {
					profile: proposerProfile,
					cliModel: undefined,
				},
				challenger: {
					profile: challengerProfile,
					cliModel: undefined,
				},
				judge:
					judgeProfile === "none"
						? "none"
						: {
								profile: judgeProfile,
								cliModel: undefined,
							},
			});

			console.log(
				`Resuming debate from round ${currentState.currentRound + 1}`,
			);
			console.log(`Topic: ${config.topic}`);

			const adapterBundle = await createAdapters(
				roles,
				createDefaultFactories(),
			);

			// Hydrate bus with old events BEFORE attaching persistence,
			// so old events populate allEvents for snapshot() but don't get re-written
			const bus = new DebateEventBus();
			for (const event of events) {
				bus.push(event);
			}

			const segmentFilename = `events-resumed-${Date.now()}.jsonl`;
			const busBundle = createBus({
				outputDir,
				segmentFilename,
				existingBus: bus,
			});

			const tuiBundle = createTui(busBundle.bus, options.headless);

			let inkInstance: { clear: () => void; unmount: () => void } | undefined;
			if (tuiBundle) {
				inkInstance = render(
					React.createElement(App, {
						store: tuiBundle.store,
						source: tuiBundle.source,
					}),
				);
			}

			// SIGINT handler
			const abortController = new AbortController();
			const triggerShutdown = () => {
				if (abortController.signal.aborted) {
					process.exit(1);
				}
				abortController.abort();
				busBundle.bus.push({
					kind: "debate.completed",
					reason: "user-interrupt",
					timestamp: Date.now(),
				});
			};
			process.on("SIGINT", triggerShutdown);

			try {
				const finalState = await runDebate(config, adapterBundle.adapters, {
					bus: busBundle.bus,
					debateId,
					outputDir,
					resumeFromState: currentState,
					transcriptWriter: busBundle.transcriptWriter,
				});

				// Always print completion info in non-TUI mode
				console.log("\nDebate completed!");
				console.log(`Reason: ${finalState.terminationReason}`);
				console.log(`Total rounds: ${finalState.currentRound}`);
				console.log(`Output saved to: ${outputDir}`);
			} finally {
				process.off("SIGINT", triggerShutdown);
				tuiBundle?.store.dispose();
				if (inkInstance) {
					inkInstance.unmount();
				}
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
