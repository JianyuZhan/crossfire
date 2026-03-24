import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeAdapter } from "@crossfire/adapter-claude";
import type { QueryFn, QueryResult } from "@crossfire/adapter-claude";
import { CODEX_TOOLS_DIR, CodexAdapter } from "@crossfire/adapter-codex";
import { GeminiAdapter } from "@crossfire/adapter-gemini";
import { runDebate } from "@crossfire/orchestrator";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { App } from "@crossfire/tui";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadProfile } from "../profile/loader.js";
import { resolveAdapterType, resolveRoles } from "../profile/resolver.js";
import { createAdapters } from "../wiring/create-adapters.js";
import type { AdapterFactoryMap } from "../wiring/create-adapters.js";
import { createBus } from "../wiring/create-bus.js";
import { createTui } from "../wiring/create-tui.js";

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
    "Judge agent profile (default: inferred from proposer; use 'none' to disable)",
  )
  .option("--max-rounds <n>", "Maximum number of rounds", "10")
  .option("--judge-every-n-rounds <n>", "Judge evaluation frequency", "3")
  .option(
    "--convergence-threshold <n>",
    "Convergence detection threshold",
    "0.3",
  )
  .option("--output <dir>", "Output directory for debate logs")
  .option("--model <model>", "Default model for all agents")
  .option("--proposer-model <model>", "Model override for proposer")
  .option("--challenger-model <model>", "Model override for challenger")
  .option("--judge-model <model>", "Model override for judge")
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

      // Load topic
      const topic =
        options.topic ?? readFileSync(options.topicFile, "utf-8").trim();

      // Load profiles
      const proposerProfile = loadProfile(options.proposer);
      const challengerProfile = loadProfile(options.challenger);

      // Resolve judge profile: infer from proposer adapter type if not specified
      const judgeDisabled = options.judge === "none";
      if (judgeDisabled && options.judgeModel) {
        console.error("Error: --judge-model cannot be used with --judge none");
        process.exit(1);
      }
      let judgeProfile: ReturnType<typeof loadProfile> | "none";
      if (judgeDisabled) {
        judgeProfile = "none";
      } else if (options.judge) {
        judgeProfile = loadProfile(options.judge);
      } else {
        // Infer from proposer's adapter type
        const adapterType = resolveAdapterType(proposerProfile.agent);
        const inferredJudge = `${adapterType}/judge`;
        judgeProfile = loadProfile(inferredJudge);
        if (options.verbose) {
          console.log(
            `  Judge profile inferred from proposer: ${inferredJudge}`,
          );
        }
      }

      // Resolve roles
      const roles = resolveRoles({
        proposer: {
          profile: proposerProfile,
          cliModel: options.proposerModel ?? options.model,
        },
        challenger: {
          profile: challengerProfile,
          cliModel: options.challengerModel ?? options.model,
        },
        judge:
          judgeProfile === "none"
            ? "none"
            : {
                profile: judgeProfile,
                cliModel: options.judgeModel ?? options.model,
              },
      });

      // Build debate config
      const config: DebateConfig = {
        topic,
        maxRounds: Number.parseInt(options.maxRounds, 10),
        judgeEveryNRounds: judgeDisabled
          ? 0
          : Number.parseInt(options.judgeEveryNRounds, 10),
        convergenceThreshold: Number.parseFloat(options.convergenceThreshold),
        proposerModel: roles.proposer.model,
        challengerModel: roles.challenger.model,
        judgeModel: roles.judge?.model,
      };

      // Generate debate ID and output directory
      const now = new Date();
      const debateId = `d-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const outputDir = options.output ?? `run_output/${debateId}`;
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Write meta.json with profile mapping
      const meta = {
        debateId,
        config,
        profiles: {
          proposer: {
            name: proposerProfile.name,
            agent: proposerProfile.agent,
            model: roles.proposer.model,
          },
          challenger: {
            name: challengerProfile.name,
            agent: challengerProfile.agent,
            model: roles.challenger.model,
          },
          ...(roles.judge && judgeProfile !== "none"
            ? {
                judge: {
                  name: judgeProfile.name,
                  agent: judgeProfile.agent,
                  model: roles.judge.model,
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
        join(outputDir, "meta.json"),
        JSON.stringify(meta, null, 2) + "\n",
      );

      if (options.verbose) {
        console.log("Configuration:");
        console.log(`  Topic: ${topic}`);
        console.log(
          `  Proposer: ${proposerProfile.name} (${roles.proposer.adapterType})`,
        );
        console.log(
          `  Challenger: ${challengerProfile.name} (${roles.challenger.adapterType})`,
        );
        if (roles.judge && judgeProfile !== "none") {
          console.log(
            `  Judge: ${judgeProfile.name} (${roles.judge.adapterType})`,
          );
        }
        console.log(`  Output: ${outputDir}`);
      }

      // Create adapter factories
      const factories: AdapterFactoryMap = {
        claude: () => {
          // Lazy-load SDK — resolved on first queryFn call
          const sdkPromise = import("@anthropic-ai/claude-agent-sdk");
          let sdkQuery: typeof import("@anthropic-ai/claude-agent-sdk").query;

          const queryFn: QueryFn = (opts) => {
            // Create an async generator that awaits SDK before yielding
            async function* gen() {
              if (!sdkQuery) {
                const sdk = await sdkPromise;
                sdkQuery = sdk.query;
              }
              const q = sdkQuery({
                prompt: opts.prompt,
                options: {
                  resume: opts.resume,
                  model: opts.model,
                  canUseTool: opts.canUseTool as never,
                  hooks: opts.hooks as never,
                  includePartialMessages: true,
                },
              });
              currentQuery = q;
              yield* q as AsyncGenerator<
                { type: string; [key: string]: unknown },
                void,
                unknown
              >;
            }

            let currentQuery: { interrupt: () => void } | undefined;
            return {
              messages: gen(),
              interrupt: () => {
                currentQuery?.interrupt();
              },
            };
          };

          return new ClaudeAdapter({ queryFn });
        },
        codex: () =>
          new CodexAdapter({
            spawnFn: () => {
              const proc = spawn("codex", ["app-server"], {
                stdio: ["pipe", "pipe", "inherit"],
                env: {
                  ...process.env,
                  PATH: `${CODEX_TOOLS_DIR}:${process.env.PATH}`,
                },
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

      // Create bus
      const busBundle = createBus({ outputDir });

      // Create TUI
      const tuiBundle = createTui(busBundle.bus, options.headless);

      // Render TUI if not headless
      let inkInstance: { clear: () => void; unmount: () => void } | undefined;
      if (tuiBundle) {
        inkInstance = render(
          React.createElement(App, {
            store: tuiBundle.store,
            source: tuiBundle.source,
            onCommand: (cmd: {
              type: string;
              requestId?: string;
              target?: string;
              text?: string;
              priority?: string;
            }) => {
              if (cmd.type === "stop") {
                triggerShutdown();
              } else if (cmd.type === "approve" || cmd.type === "deny") {
                const state = tuiBundle.store.getState();
                const pending = state.command.pendingApprovals;
                const requestId = cmd.requestId ?? pending[0]?.requestId;
                if (requestId) {
                  const decision = cmd.type === "approve" ? "allow" : "deny";
                  for (const a of [
                    adapterBundle.adapters.proposer,
                    adapterBundle.adapters.challenger,
                  ]) {
                    a.adapter.approve?.({ requestId, decision });
                  }
                }
              } else if (cmd.type === "inject") {
                const targets: Array<"proposer" | "challenger"> =
                  cmd.target === "both"
                    ? ["proposer", "challenger"]
                    : [cmd.target as "proposer" | "challenger"];
                for (const t of targets) {
                  busBundle.bus.push({
                    kind: "user.inject",
                    target: t,
                    text: cmd.text ?? "",
                    priority: (cmd.priority ?? "normal") as "normal" | "high",
                    timestamp: Date.now(),
                  });
                }
              } else if (cmd.type === "inject-judge") {
                busBundle.bus.push({
                  kind: "user.inject",
                  target: "judge",
                  text: cmd.text ?? "",
                  priority: "high",
                  timestamp: Date.now(),
                });
              }
            },
          }),
        );
      }

      // Abort controller for graceful shutdown
      const abortController = new AbortController();

      const triggerShutdown = () => {
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

      process.on("SIGINT", triggerShutdown);

      // Run debate
      try {
        const finalState = await runDebate(config, adapterBundle.adapters, {
          bus: busBundle.bus,
          debateId,
          outputDir,
        });

        // Give TUI time to render the final summary before unmount
        if (inkInstance) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (!options.headless) {
          console.log("\nDebate completed!");
          console.log(`Reason: ${finalState.terminationReason}`);
          console.log(`Total rounds: ${finalState.currentRound}`);
          console.log(`Output saved to: ${outputDir}`);
        }
      } finally {
        // Cleanup
        process.off("SIGINT", triggerShutdown);
        if (inkInstance) {
          inkInstance.unmount();
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
