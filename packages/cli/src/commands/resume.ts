import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeAdapter } from "@crossfire/adapter-claude";
import { CodexAdapter } from "@crossfire/adapter-codex";
import { GeminiAdapter } from "@crossfire/adapter-gemini";
import { EventStore, runDebate } from "@crossfire/orchestrator";
import { projectState } from "@crossfire/orchestrator-core";
import { App } from "@crossfire/tui";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadProfile } from "../profile/loader.js";
import { resolveRoles } from "../profile/resolver.js";
import type { ProfileConfig } from "../profile/schema.js";
import { createAdapters } from "../wiring/create-adapters.js";
import type { AdapterFactoryMap } from "../wiring/create-adapters.js";
import { createBus } from "../wiring/create-bus.js";
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
      // Read meta.json
      const metaPath = join(outputDir, "meta.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));

      if (!meta.config) {
        console.error("Error: meta.json missing config field");
        process.exit(1);
      }

      const config = meta.config;

      // Load existing events
      const events = EventStore.loadSegments(outputDir);
      const currentState = projectState(events);

      // Check if debate is already completed
      if (currentState.phase === "completed") {
        console.log("Debate already completed.");
        console.log(`Reason: ${currentState.terminationReason}`);
        console.log(`Total rounds: ${currentState.currentRound}`);
        process.exit(0);
      }

      // Load profiles (CLI overrides or from meta.json)
      const proposerProfile = options.proposer
        ? loadProfile(options.proposer)
        : loadProfileFromMeta(meta.profiles.proposer);
      const challengerProfile = options.challenger
        ? loadProfile(options.challenger)
        : loadProfileFromMeta(meta.profiles.challenger);
      const judgeProfile = meta.profiles.judge
        ? options.judge
          ? loadProfile(options.judge)
          : loadProfileFromMeta(meta.profiles.judge)
        : "none";

      // Resolve roles
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

      // Create adapter factories
      const factories: AdapterFactoryMap = {
        claude: () =>
          new ClaudeAdapter({
            queryFn: (opts) => {
              throw new Error("Claude SDK integration not yet implemented");
            },
          }),
        codex: () =>
          new CodexAdapter({
            spawnFn: () => {
              const proc = spawn("codex", ["app-server", "--stdio"], {
                stdio: ["pipe", "pipe", "inherit"],
              });
              return {
                stdin: proc.stdin,
                stdout: proc.stdout,
              };
            },
          }),
        gemini: () => new GeminiAdapter(),
      };

      // Create adapters
      const adapterBundle = await createAdapters(roles, factories);

      // Create bus with new segment
      const segmentFilename = `events-resume-${Date.now()}.jsonl`;
      const busBundle = createBus({ outputDir, segmentFilename });

      // Feed existing events to bus
      for (const event of events) {
        busBundle.bus.push(event);
      }

      // Create TUI
      const tuiBundle = createTui(busBundle.bus, options.headless);

      // Render TUI if not headless
      let inkInstance: { clear: () => void; unmount: () => void } | undefined;
      if (tuiBundle) {
        // Enter alternate screen for fullscreen viewport
        process.stdout.write("\x1b[?1049h");
        inkInstance = render(
          React.createElement(App, {
            store: tuiBundle.store,
            source: tuiBundle.source,
          }),
        );
      }

      // SIGINT handler
      let interrupted = false;
      const handleInterrupt = () => {
        if (interrupted) return;
        interrupted = true;
        busBundle.bus.push({
          kind: "debate.completed",
          reason: "user-interrupt",
          timestamp: Date.now(),
        });
      };
      process.on("SIGINT", handleInterrupt);

      // Run debate with resume
      try {
        const finalState = await runDebate(config, adapterBundle.adapters, {
          bus: busBundle.bus,
          resumeFromState: currentState,
        });

        if (!options.headless) {
          console.log("\nDebate completed!");
          console.log(`Reason: ${finalState.terminationReason}`);
          console.log(`Total rounds: ${finalState.currentRound}`);
        }
      } finally {
        // Cleanup
        process.off("SIGINT", handleInterrupt);
        if (inkInstance) {
          inkInstance.unmount();
          // Leave alternate screen
          process.stdout.write("\x1b[?1049l");
        }
        await adapterBundle.closeAll();
        await busBundle.close();
      }
    } catch (error) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

function loadProfileFromMeta(metaProfile: { name: string }): ProfileConfig {
  // Load profile by name from meta.json
  return loadProfile(metaProfile.name);
}
