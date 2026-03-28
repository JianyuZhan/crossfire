import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";

export const statusCommand = new Command("status")
	.description("Display status of a debate")
	.argument("<output-dir>", "Output directory containing the debate")
	.option("--json", "Output as JSON", false)
	.action(async (outputDir: string, options) => {
		try {
			// Read index.json (unified metadata + runtime data)
			const indexPath = join(outputDir, "index.json");
			const index = JSON.parse(readFileSync(indexPath, "utf-8"));

			if (options.json) {
				// JSON output
				console.log(JSON.stringify(index, null, 2));
			} else {
				// Formatted output
				console.log("Debate Status");
				console.log("=============\n");

				console.log(`Debate ID: ${index.debateId}`);
				console.log(`Topic: ${index.topic}`);
				console.log(`Started: ${new Date(index.startedAt).toISOString()}`);
				console.log(`Ended: ${new Date(index.endedAt).toISOString()}`);
				console.log(
					`Duration: ${formatDuration(index.endedAt - index.startedAt)}`,
				);
				console.log();

				console.log(`Total Rounds: ${index.totalRounds}`);
				console.log(`Total Events: ${index.totalEvents}`);
				console.log(
					`Termination Reason: ${index.terminationReason ?? "in-progress"}`,
				);
				console.log();

				// Segments info
				if (index.segments && index.segments.length > 1) {
					console.log("Segments:");
					for (const seg of index.segments) {
						console.log(`  - ${seg.file}: ${seg.eventCount} events`);
					}
					console.log();
				}

				// Profiles
				if (index.profiles) {
					console.log("Profiles:");
					printProfileRole("Proposer", index.profiles.proposer);
					printProfileRole("Challenger", index.profiles.challenger);
					if (index.profiles.judge) {
						printProfileRole("Judge", index.profiles.judge);
					}
					console.log();
				}

				// Config
				if (index.config) {
					console.log("Configuration:");
					console.log(`  Max Rounds: ${index.config.maxRounds}`);
					console.log(
						`  Judge Every N Rounds: ${index.config.judgeEveryNRounds}`,
					);
					console.log(
						`  Convergence Threshold: ${index.config.convergenceThreshold}`,
					);
				}
			}
		} catch (error) {
			console.error(
				"Error:",
				error instanceof Error ? error.message : String(error),
			);
			process.exit(1);
		}
	});

function printProfileRole(
	label: string,
	profile: { name: string; agent: string; model?: string },
): void {
	console.log(`  ${label}: ${profile.name} (${profile.agent})`);
	if (profile.model) {
		console.log(`    Model: ${profile.model}`);
	}
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}
