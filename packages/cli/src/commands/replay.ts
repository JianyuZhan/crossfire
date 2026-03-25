import { replayDebate } from "@crossfire/tui";
import { Command } from "commander";

export const replayCommand = new Command("replay")
	.description("Replay a completed debate")
	.argument("<output-dir>", "Output directory containing the debate")
	.option("--speed <n>", "Playback speed multiplier", "1")
	.option("--from-round <n>", "Start replay from specific round")
	.action(async (outputDir: string, options) => {
		try {
			const speed = Number.parseFloat(options.speed);
			if (!Number.isFinite(speed) || speed <= 0) {
				console.error("Error: --speed must be a positive number");
				return process.exit(1);
			}
			const fromRoundRaw = options.fromRound
				? Number.parseFloat(options.fromRound)
				: undefined;
			if (
				fromRoundRaw !== undefined &&
				(!Number.isFinite(fromRoundRaw) ||
					fromRoundRaw < 1 ||
					!Number.isInteger(fromRoundRaw))
			) {
				console.error("Error: --from-round must be a positive integer");
				return process.exit(1);
			}
			const startFromRound = fromRoundRaw;

			console.log(`Replaying debate from ${outputDir}`);
			if (startFromRound !== undefined) {
				console.log(`Starting from round ${startFromRound}`);
			}
			console.log(`Playback speed: ${speed}x\n`);

			// Use replayDebate from TUI — reads index.json segments for multi-segment support
			await replayDebate({
				outputDir,
				speed,
				startFromRound,
			});

			console.log("\nReplay completed!");
		} catch (error) {
			console.error(
				"Error:",
				error instanceof Error ? error.message : String(error),
			);
			process.exit(1);
		}
	});
