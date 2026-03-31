import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
	type MockAdapterFactory,
	type ScenarioFixture,
	type ScenarioStep,
	runContractTests,
} from "@crossfire/adapter-core/testing";
import { GeminiAdapter } from "../src/gemini-adapter.js";
import { ProcessManager } from "../src/process-manager.js";

type MockChildProcess = ChildProcess &
	EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		pid: number;
		kill: (signal?: number | NodeJS.Signals) => boolean;
	};

/**
 * Converts a ScenarioStep into a Gemini JSONL line.
 */
function stepToJsonLine(step: ScenarioStep): string | null {
	switch (step.kind) {
		case "session-init":
			return JSON.stringify({
				type: "init",
				session_id: step.sessionId,
				model: step.model,
				tools: [],
			});
		case "assistant-delta":
			return JSON.stringify({
				type: "message",
				text: step.text,
			});
		case "thinking-delta":
			return JSON.stringify({
				type: "thought",
				text: step.text,
			});
		case "tool-call":
			return JSON.stringify({
				type: "tool_use",
				tool_use_id: step.toolUseId,
				name: step.toolName,
				input: step.input,
			});
		case "tool-result":
			return JSON.stringify({
				type: "tool_result",
				tool_use_id: step.toolUseId,
				name: step.toolName,
				success: step.success,
				output: step.output,
			});
		case "turn-result":
			return JSON.stringify({
				type: "result",
				usage: step.usage
					? {
							input_tokens: step.usage.inputTokens,
							output_tokens: step.usage.outputTokens,
						}
					: undefined,
				duration_ms: 100,
			});
		case "error":
			return JSON.stringify({
				type: "error",
				message: step.message,
				fatal: true,
			});
		// Gemini doesn't support approval or subagent events
		case "approval-request":
		case "approval-resolved":
		case "subagent-started":
		case "subagent-completed":
		case "warning":
		case "plan-updated":
			return null;
		default:
			return null;
	}
}

/**
 * Splits fixture steps into per-turn groups based on turn-result or error.
 * For MULTI_TURN scenario, the first turn includes session-init, subsequent turns don't.
 */
function scenarioToSpawnBehaviors(
	fixture: ScenarioFixture,
): Array<{ lines: string[]; exitCode: number }> {
	const behaviors: Array<{ lines: string[]; exitCode: number }> = [];
	let currentLines: string[] = [];

	for (const step of fixture.steps) {
		const line = stepToJsonLine(step);
		if (line !== null) {
			currentLines.push(line);
		}

		// End of turn: emit current lines as a process
		if (step.kind === "turn-result") {
			behaviors.push({ lines: [...currentLines], exitCode: 0 });
			currentLines = [];
		} else if (step.kind === "error") {
			behaviors.push({ lines: [...currentLines], exitCode: 1 });
			currentLines = [];
		}
	}

	// If there are leftover lines (shouldn't happen in well-formed fixtures), add them
	if (currentLines.length > 0) {
		behaviors.push({ lines: currentLines, exitCode: 0 });
	}

	return behaviors;
}

/**
 * Creates a mock spawn function that returns mock processes emitting JSONL lines.
 * Each call to spawn returns a new process from the behaviors array.
 */
function createMockSpawnFn(
	behaviors: Array<{ lines: string[]; exitCode: number }>,
): (cmd: string, args: string[], options?: object) => ChildProcess {
	let spawnIndex = 0;

	return (_cmd: string, _args: string[], _opts?: object): ChildProcess => {
		const behavior = behaviors[spawnIndex++] ?? { lines: [], exitCode: 1 };

		// Create mock stdout/stderr streams
		const stdout = new PassThrough();
		const stderr = new PassThrough();

		// Create mock process using EventEmitter
		const proc = new EventEmitter() as unknown as MockChildProcess;
		proc.stdout = stdout;
		proc.stderr = stderr;
		proc.pid = 99999;
		proc.kill = (signal?: string | number) => {
			// Emit exit event when killed
			setImmediate(() => {
				proc.emit("exit", null, signal);
			});
			return true;
		};

		// Emit JSONL lines and exit asynchronously
		setImmediate(() => {
			for (const line of behavior.lines) {
				stdout.write(`${line}\n`);
			}
			stdout.end();
			proc.emit("exit", behavior.exitCode, null);
		});

		return proc as ChildProcess;
	};
}

/**
 * MockAdapterFactory for Gemini contract tests.
 * Creates a GeminiAdapter with a mock ProcessManager that replays scenario steps as JSONL.
 */
const factory: MockAdapterFactory = {
	async create(fixture: ScenarioFixture) {
		const behaviors = scenarioToSpawnBehaviors(fixture);
		const spawnFn = createMockSpawnFn(behaviors);
		const processManager = new ProcessManager(spawnFn);
		return new GeminiAdapter({ processManager });
	},
	async cleanup() {
		// No cleanup needed for GeminiAdapter
	},
};

// Run the contract test suite
runContractTests("Gemini", factory);
