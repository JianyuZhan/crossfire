import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Since statusCommand uses Commander .action() with console.log/console.error
 * and process.exit, we test by invoking the command's parseAsync and capturing output.
 *
 * We import the command and simulate CLI invocation via parseAsync.
 */
import { statusCommand } from "../src/commands/status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir with an index.json containing the given data. */
function createTempDebate(indexData: Record<string, unknown>): string {
	const dir = mkdtempSync(join(tmpdir(), "crossfire-status-test-"));
	writeFileSync(join(dir, "index.json"), JSON.stringify(indexData));
	return dir;
}

/** Minimal valid index.json data for a completed debate. */
function makeIndex(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		debateId: "d-20260321-143022",
		topic: "Should we use TypeScript?",
		startedAt: 1711021822000,
		endedAt: 1711023456000,
		totalEvents: 4523,
		totalRounds: 8,
		terminationReason: "convergence",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Setup / Teardown: capture console output
// ---------------------------------------------------------------------------

let logOutput: string[];
let errorOutput: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	logOutput = [];
	errorOutput = [];
	originalLog = console.log;
	originalError = console.error;
	console.log = (...args: unknown[]) => {
		logOutput.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		errorOutput.push(args.map(String).join(" "));
	};
	// Prevent process.exit from actually exiting the test runner
	exitSpy = vi
		.spyOn(process, "exit")
		.mockImplementation((() => {}) as unknown as () => never);
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	exitSpy.mockRestore();
});

/** Helper: run the status command with given args. */
async function runStatus(...args: string[]): Promise<void> {
	// Commander mutates internal state, so we create a fresh copy each time
	// by using parseAsync with exitOverride to prevent Commander from calling process.exit
	const cmd = statusCommand;
	// Reset Commander internal state by using parseAsync directly
	await cmd.parseAsync(["node", "status", ...args]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("crossfire status", () => {
	describe("formatted output (default)", () => {
		it("displays basic debate info", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Debate Status");
			expect(output).toContain("=============");
			expect(output).toContain("Debate ID: d-20260321-143022");
			expect(output).toContain("Topic: Should we use TypeScript?");
			expect(output).toContain("Started:");
			expect(output).toContain("Ended:");
			expect(output).toContain("Total Rounds: 8");
			expect(output).toContain("Total Events: 4523");
			expect(output).toContain("Termination Reason: convergence");
		});

		it("formats startedAt and endedAt as ISO strings", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir);

			const output = logOutput.join("\n");
			// 1711021822000 → 2024-03-21T...
			expect(output).toContain(
				`Started: ${new Date(1711021822000).toISOString()}`,
			);
			expect(output).toContain(
				`Ended: ${new Date(1711023456000).toISOString()}`,
			);
		});

		it("displays duration in seconds for short debates", async () => {
			// 45 seconds = 45000ms
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 1045000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 45s");
		});

		it("displays duration in minutes + seconds", async () => {
			// 3m 25s = 205000ms
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 1205000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 3m 25s");
		});

		it("displays duration in hours + minutes + seconds", async () => {
			// 2h 15m 30s = 8130000ms
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 9130000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 2h 15m 30s");
		});

		it("shows 'in-progress' when terminationReason is absent", async () => {
			const dir = createTempDebate(makeIndex({ terminationReason: undefined }));
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Termination Reason: in-progress");
		});

		it("shows 'in-progress' when terminationReason is null", async () => {
			const dir = createTempDebate(makeIndex({ terminationReason: null }));
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Termination Reason: in-progress");
		});

		it("displays various termination reasons", async () => {
			for (const reason of ["convergence", "max-rounds", "user-interrupt"]) {
				logOutput = [];
				const dir = createTempDebate(makeIndex({ terminationReason: reason }));
				await runStatus(dir);

				const output = logOutput.join("\n");
				expect(output).toContain(`Termination Reason: ${reason}`);
			}
		});
	});

	describe("segments display", () => {
		it("skips segments section when there is only one segment", async () => {
			const dir = createTempDebate(
				makeIndex({
					segments: [{ file: "events.jsonl", eventCount: 42 }],
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Segments:");
		});

		it("skips segments section when segments is absent", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Segments:");
		});

		it("displays segments when there are multiple", async () => {
			const dir = createTempDebate(
				makeIndex({
					segments: [
						{ file: "events.jsonl", eventCount: 42 },
						{ file: "events-resumed-1711001000.jsonl", eventCount: 18 },
					],
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Segments:");
			expect(output).toContain("  - events.jsonl: 42 events");
			expect(output).toContain(
				"  - events-resumed-1711001000.jsonl: 18 events",
			);
		});

		it("displays segments when there are three or more", async () => {
			const dir = createTempDebate(
				makeIndex({
					segments: [
						{ file: "events.jsonl", eventCount: 10 },
						{ file: "events-resumed-1.jsonl", eventCount: 20 },
						{ file: "events-resumed-2.jsonl", eventCount: 30 },
					],
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Segments:");
			expect(output).toContain("  - events.jsonl: 10 events");
			expect(output).toContain("  - events-resumed-1.jsonl: 20 events");
			expect(output).toContain("  - events-resumed-2.jsonl: 30 events");
		});
	});

	describe("profiles display", () => {
		it("displays proposer and challenger profiles", async () => {
			const dir = createTempDebate(
				makeIndex({
					profiles: {
						proposer: { name: "debate_proposer", agent: "claude" },
						challenger: { name: "debate_challenger", agent: "codex" },
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Profiles:");
			expect(output).toContain("  Proposer: debate_proposer (claude)");
			expect(output).toContain("  Challenger: debate_challenger (codex)");
		});

		it("displays model info when present", async () => {
			const dir = createTempDebate(
				makeIndex({
					profiles: {
						proposer: {
							name: "debate_proposer",
							agent: "claude",
							model: "claude-sonnet-4-20250514",
						},
						challenger: {
							name: "debate_challenger",
							agent: "codex",
							model: "gpt-5.4",
						},
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("    Model: claude-sonnet-4-20250514");
			expect(output).toContain("    Model: gpt-5.4");
		});

		it("omits model line when model is not set", async () => {
			const dir = createTempDebate(
				makeIndex({
					profiles: {
						proposer: { name: "debate_proposer", agent: "claude" },
						challenger: { name: "debate_challenger", agent: "codex" },
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Model:");
		});

		it("displays judge profile when present", async () => {
			const dir = createTempDebate(
				makeIndex({
					profiles: {
						proposer: { name: "debate_proposer", agent: "claude" },
						challenger: { name: "debate_challenger", agent: "codex" },
						judge: {
							name: "debate_judge",
							agent: "gemini",
							model: "gemini-2.5-pro",
						},
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("  Judge: debate_judge (gemini)");
			expect(output).toContain("    Model: gemini-2.5-pro");
		});

		it("omits judge when not present in profiles", async () => {
			const dir = createTempDebate(
				makeIndex({
					profiles: {
						proposer: { name: "debate_proposer", agent: "claude" },
						challenger: { name: "debate_challenger", agent: "codex" },
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Judge:");
		});

		it("skips profiles section entirely when absent", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Profiles:");
		});
	});

	describe("config display", () => {
		it("displays configuration when present", async () => {
			const dir = createTempDebate(
				makeIndex({
					config: {
						maxRounds: 10,
						judgeEveryNRounds: 2,
						convergenceThreshold: 0.85,
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Configuration:");
			expect(output).toContain("  Max Rounds: 10");
			expect(output).toContain("  Judge Every N Rounds: 2");
			expect(output).toContain("  Convergence Threshold: 0.85");
		});

		it("skips config section when absent", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).not.toContain("Configuration:");
		});
	});

	describe("--json mode", () => {
		it("outputs raw JSON with pretty formatting", async () => {
			const data = makeIndex();
			const dir = createTempDebate(data);
			await runStatus(dir, "--json");

			const output = logOutput.join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.debateId).toBe("d-20260321-143022");
			expect(parsed.topic).toBe("Should we use TypeScript?");
			expect(parsed.totalRounds).toBe(8);
			expect(parsed.totalEvents).toBe(4523);
			expect(parsed.terminationReason).toBe("convergence");
		});

		it("includes all fields in JSON output", async () => {
			const data = makeIndex({
				segments: [{ file: "events.jsonl", eventCount: 42 }],
				config: { maxRounds: 10, judgeEveryNRounds: 2 },
				profiles: {
					proposer: { name: "p", agent: "claude" },
					challenger: { name: "c", agent: "codex" },
				},
			});
			const dir = createTempDebate(data);
			await runStatus(dir, "--json");

			const output = logOutput.join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.segments).toHaveLength(1);
			expect(parsed.config.maxRounds).toBe(10);
			expect(parsed.profiles.proposer.name).toBe("p");
		});

		it("does not include formatted headers in JSON mode", async () => {
			const dir = createTempDebate(makeIndex());
			await runStatus(dir, "--json");

			const output = logOutput.join("\n");
			expect(output).not.toContain("Debate Status");
			expect(output).not.toContain("=============");
		});
	});

	describe("error handling", () => {
		it("prints error and exits 1 when output dir does not exist", async () => {
			await runStatus("/nonexistent/path/to/debate");

			expect(errorOutput.length).toBeGreaterThan(0);
			expect(errorOutput[0]).toContain("Error:");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("prints error and exits 1 when index.json is missing", async () => {
			const dir = mkdtempSync(join(tmpdir(), "crossfire-status-test-"));
			await runStatus(dir);

			expect(errorOutput.length).toBeGreaterThan(0);
			expect(errorOutput[0]).toContain("Error:");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("prints error and exits 1 when index.json contains malformed JSON", async () => {
			const dir = mkdtempSync(join(tmpdir(), "crossfire-status-test-"));
			writeFileSync(join(dir, "index.json"), "{ invalid json }}}");
			await runStatus(dir);

			expect(errorOutput.length).toBeGreaterThan(0);
			expect(errorOutput[0]).toContain("Error:");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe("formatDuration (tested indirectly via output)", () => {
		it("formats 0ms as 0s", async () => {
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 1000000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 0s");
		});

		it("formats sub-second durations as 0s (floor)", async () => {
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 1000999 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 0s");
		});

		it("formats exactly 60 seconds as 1m 0s", async () => {
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 1060000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 1m 0s");
		});

		it("formats exactly 1 hour as 1h 0m 0s", async () => {
			const dir = createTempDebate(
				makeIndex({ startedAt: 1000000, endedAt: 4600000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 1h 0m 0s");
		});

		it("formats 1h 1m 1s correctly", async () => {
			// 3661 seconds = 3661000ms
			const dir = createTempDebate(
				makeIndex({ startedAt: 0, endedAt: 3661000 }),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");
			expect(output).toContain("Duration: 1h 1m 1s");
		});
	});

	describe("full output ordering", () => {
		it("prints sections in correct order: header, basic info, segments, profiles, config", async () => {
			const dir = createTempDebate(
				makeIndex({
					segments: [
						{ file: "events.jsonl", eventCount: 42 },
						{ file: "events-resumed.jsonl", eventCount: 18 },
					],
					profiles: {
						proposer: { name: "p", agent: "claude" },
						challenger: { name: "c", agent: "codex" },
						judge: { name: "j", agent: "gemini" },
					},
					config: {
						maxRounds: 10,
						judgeEveryNRounds: 2,
						convergenceThreshold: 0.85,
					},
				}),
			);
			await runStatus(dir);

			const output = logOutput.join("\n");

			// Verify section ordering via index positions
			const headerPos = output.indexOf("Debate Status");
			const debateIdPos = output.indexOf("Debate ID:");
			const segmentsPos = output.indexOf("Segments:");
			const profilesPos = output.indexOf("Profiles:");
			const configPos = output.indexOf("Configuration:");

			expect(headerPos).toBeLessThan(debateIdPos);
			expect(debateIdPos).toBeLessThan(segmentsPos);
			expect(segmentsPos).toBeLessThan(profilesPos);
			expect(profilesPos).toBeLessThan(configPos);
		});
	});
});
