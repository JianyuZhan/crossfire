import { type Mock, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @crossfire/tui — intercept replayDebate so we never launch real TUI
// ---------------------------------------------------------------------------
vi.mock("@crossfire/tui", () => ({
	replayDebate: vi.fn().mockResolvedValue({}),
}));

// We need to import after the mock is set up
import { replayDebate } from "@crossfire/tui";
import { replayCommand } from "../src/commands/replay.js";

const mockReplayDebate = replayDebate as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Suppress process.exit so tests don't terminate the runner.
 * Validation guards use `return process.exit(1)` so execution stops
 * even when process.exit is mocked.
 */
const mockExit = vi
	.spyOn(process, "exit")
	.mockImplementation((() => {}) as never);

const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi
	.spyOn(console, "error")
	.mockImplementation(() => {});

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Parse the replay command with the given argv tokens.
 * Commander expects the first two elements to be node + script path.
 */
async function runReplay(args: string[]): Promise<void> {
	await replayCommand.parseAsync(["node", "replay", ...args]);
}

// ===========================================================================
// 1. Option validation: --speed
// ===========================================================================
describe("replay --speed validation", () => {
	it("accepts default speed (1) when --speed is omitted", async () => {
		await runReplay(["/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ speed: 1 }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("accepts a valid positive speed", async () => {
		await runReplay(["--speed", "2.5", "/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ speed: 2.5 }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("accepts fractional speed less than 1", async () => {
		await runReplay(["--speed", "0.25", "/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ speed: 0.25 }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("reports error and exits for speed = 0", async () => {
		await runReplay(["--speed", "0", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --speed must be a positive number",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports error and exits for negative speed", async () => {
		await runReplay(["--speed", "-3", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --speed must be a positive number",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports error and exits for NaN speed", async () => {
		await runReplay(["--speed", "abc", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --speed must be a positive number",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports error and exits for Infinity speed", async () => {
		await runReplay(["--speed", "Infinity", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --speed must be a positive number",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("does not call replayDebate after validation failure", async () => {
		await runReplay(["--speed", "0", "/tmp/debate-output"]);

		expect(mockExit).toHaveBeenCalledWith(1);
		expect(mockReplayDebate).not.toHaveBeenCalled();
	});
});

// ===========================================================================
// 2. Option validation: --from-round
// ===========================================================================
describe("replay --from-round validation", () => {
	it("omits startFromRound when --from-round is not provided", async () => {
		await runReplay(["/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ startFromRound: undefined }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("accepts a valid positive integer", async () => {
		await runReplay(["--from-round", "3", "/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ startFromRound: 3 }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("accepts --from-round 1 (minimum valid value)", async () => {
		await runReplay(["--from-round", "1", "/tmp/debate-output"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ startFromRound: 1 }),
		);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("reports error and exits for --from-round 0", async () => {
		await runReplay(["--from-round", "0", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --from-round must be a positive integer",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports error and exits for negative --from-round", async () => {
		await runReplay(["--from-round", "-2", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --from-round must be a positive integer",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports error and exits for NaN --from-round", async () => {
		await runReplay(["--from-round", "xyz", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --from-round must be a positive integer",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("rejects fractional --from-round values", async () => {
		await runReplay(["--from-round", "2.7", "/tmp/debate-output"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --from-round must be a positive integer",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});
});

// ===========================================================================
// 3. Events path construction
// ===========================================================================
describe("replay events path construction", () => {
	it("passes outputDir to replayDebate for multi-segment support", async () => {
		const outputDir = "/tmp/my-debate";
		await runReplay([outputDir]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({ outputDir }),
		);
	});

	it("handles output dir with trailing slash", async () => {
		await runReplay(["/tmp/debate/"]);

		expect(mockReplayDebate).toHaveBeenCalledWith(
			expect.objectContaining({
				outputDir: "/tmp/debate/",
			}),
		);
	});
});

// ===========================================================================
// 4. Console output messages
// ===========================================================================
describe("replay console output", () => {
	it("prints replay header with output directory", async () => {
		await runReplay(["/tmp/debate-output"]);

		expect(mockConsoleLog).toHaveBeenCalledWith(
			"Replaying debate from /tmp/debate-output",
		);
	});

	it("prints playback speed", async () => {
		await runReplay(["--speed", "3", "/tmp/debate-output"]);

		expect(mockConsoleLog).toHaveBeenCalledWith("Playback speed: 3x\n");
	});

	it("prints starting round when --from-round is specified", async () => {
		await runReplay(["--from-round", "5", "/tmp/debate-output"]);

		expect(mockConsoleLog).toHaveBeenCalledWith("Starting from round 5");
	});

	it("does NOT print starting round when --from-round is omitted", async () => {
		await runReplay(["/tmp/debate-output"]);

		const roundMessages = mockConsoleLog.mock.calls.filter(
			([msg]: string[]) =>
				typeof msg === "string" && msg.startsWith("Starting from round"),
		);
		expect(roundMessages).toHaveLength(0);
	});

	it("prints completion message after successful replay", async () => {
		await runReplay(["/tmp/debate-output"]);

		expect(mockConsoleLog).toHaveBeenCalledWith("\nReplay completed!");
	});

	it("prints default speed when --speed is omitted", async () => {
		await runReplay(["/tmp/debate-output"]);

		expect(mockConsoleLog).toHaveBeenCalledWith("Playback speed: 1x\n");
	});
});

// ===========================================================================
// 5. Error handling for replayDebate failures
// ===========================================================================
describe("replay error handling", () => {
	it("catches Error thrown by replayDebate and prints message", async () => {
		mockReplayDebate.mockRejectedValueOnce(
			new Error("ENOENT: no such file or directory"),
		);

		await runReplay(["/tmp/nonexistent"]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error:",
			"ENOENT: no such file or directory",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("catches non-Error thrown by replayDebate and stringifies", async () => {
		mockReplayDebate.mockRejectedValueOnce("string error");

		await runReplay(["/tmp/bad-debate"]);

		expect(mockConsoleError).toHaveBeenCalledWith("Error:", "string error");
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("handles numeric thrown value via String()", async () => {
		mockReplayDebate.mockRejectedValueOnce(42);

		await runReplay(["/tmp/bad-debate"]);

		expect(mockConsoleError).toHaveBeenCalledWith("Error:", "42");
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("does not print completion message on failure", async () => {
		mockReplayDebate.mockRejectedValueOnce(new Error("parse failure"));

		await runReplay(["/tmp/corrupt"]);

		const completionCalls = mockConsoleLog.mock.calls.filter(
			([msg]: string[]) =>
				typeof msg === "string" && msg.includes("Replay completed"),
		);
		expect(completionCalls).toHaveLength(0);
	});
});

// ===========================================================================
// 6. Combined options
// ===========================================================================
describe("replay combined options", () => {
	it("passes all options correctly when both --speed and --from-round are set", async () => {
		await runReplay([
			"--speed",
			"4",
			"--from-round",
			"2",
			"/tmp/debate-output",
		]);

		expect(mockReplayDebate).toHaveBeenCalledWith({
			outputDir: "/tmp/debate-output",
			speed: 4,
			startFromRound: 2,
		});
		expect(mockExit).not.toHaveBeenCalled();
	});

	it("reports speed error even when --from-round is valid", async () => {
		await runReplay([
			"--speed",
			"-1",
			"--from-round",
			"2",
			"/tmp/debate-output",
		]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --speed must be a positive number",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("reports from-round error even when --speed is valid", async () => {
		await runReplay([
			"--speed",
			"2",
			"--from-round",
			"-1",
			"/tmp/debate-output",
		]);

		expect(mockConsoleError).toHaveBeenCalledWith(
			"Error: --from-round must be a positive integer",
		);
		expect(mockExit).toHaveBeenCalledWith(1);
	});
});

// ===========================================================================
// 7. Command metadata
// ===========================================================================
describe("replay command metadata", () => {
	it("has name 'replay'", () => {
		expect(replayCommand.name()).toBe("replay");
	});

	it("has a description", () => {
		expect(replayCommand.description()).toBe("Replay a completed debate");
	});

	it("requires <output-dir> argument", () => {
		const args = replayCommand.registeredArguments;
		expect(args).toHaveLength(1);
		expect(args[0].name()).toBe("output-dir");
		expect(args[0].required).toBe(true);
	});

	it("defines --speed option with default '1'", () => {
		const speedOpt = replayCommand.options.find((o) => o.long === "--speed");
		expect(speedOpt).toBeDefined();
		expect(speedOpt?.defaultValue).toBe("1");
	});

	it("defines --from-round option without default", () => {
		const fromRoundOpt = replayCommand.options.find(
			(o) => o.long === "--from-round",
		);
		expect(fromRoundOpt).toBeDefined();
		expect(fromRoundOpt?.defaultValue).toBeUndefined();
	});
});
