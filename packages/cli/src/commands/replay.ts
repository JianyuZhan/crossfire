import { join } from "node:path";
import { replayDebate } from "@crossfire/tui";
import { Command } from "commander";

export const replayCommand = new Command("replay")
	.description("Replay a completed debate")
	.argument("<output-dir>", "Output directory containing the debate")
	.option("--speed <n>", "Playback speed multiplier", "1")
	.option("--from-round <n>", "Start replay from specific round")
	.action(async (outputDir: string, options) => {
		try {
			const eventsPath = join(outputDir, "events.jsonl");
			const speed = Number.parseFloat(options.speed);
			const startFromRound = options.fromRound
				? Number.parseInt(options.fromRound, 10)
				: undefined;

			console.log(`Replaying debate from ${outputDir}`);
			if (startFromRound !== undefined) {
				console.log(`Starting from round ${startFromRound}`);
			}
			console.log(`Playback speed: ${speed}x\n`);

			// Use replayDebate from TUI
			const store = await replayDebate({
				eventsPath,
				speed,
				startFromRound,
			});

			// Note: replayDebate already runs the full replay and returns when complete
			// The TUI rendering is handled internally by replayDebate
			// For now, we just acknowledge completion
			console.log("\nReplay completed!");
		} catch (error) {
			console.error(
				"Error:",
				error instanceof Error ? error.message : String(error),
			);
			process.exit(1);
		}
	});
