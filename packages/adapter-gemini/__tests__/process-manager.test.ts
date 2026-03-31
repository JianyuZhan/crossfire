import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { type ProcessHandle, ProcessManager } from "../src/process-manager.js";

type MockChildProcess = ChildProcess &
	EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		kill: ReturnType<typeof vi.fn>;
		pid: number;
	};

function createMockProcess(lines: string[] = [], exitCode = 0) {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const proc = new EventEmitter() as unknown as MockChildProcess;
	proc.stdout = stdout;
	proc.stderr = stderr;
	proc.kill = vi.fn();
	proc.pid = 12345;

	// Feed lines async
	setImmediate(() => {
		for (const line of lines) {
			stdout.write(`${line}\n`);
		}
		stdout.end();
		proc.emit("exit", exitCode);
	});

	return proc;
}

describe("ProcessManager", () => {
	it("spawns process with correct binary and args", () => {
		const spawnFn = vi.fn().mockReturnValue(createMockProcess());
		const pm = new ProcessManager(spawnFn);
		pm.spawn(["--output-format", "stream-json", "-p", "hello"]);
		expect(spawnFn).toHaveBeenCalledWith(
			"gemini",
			["--output-format", "stream-json", "-p", "hello"],
			expect.any(Object),
		);
	});

	it("returns handle with pid", () => {
		const spawnFn = vi.fn().mockReturnValue(createMockProcess());
		const pm = new ProcessManager(spawnFn);
		const handle = pm.spawn(["--output-format", "stream-json"]);
		expect(handle.pid).toBe(12345);
	});

	it("delivers stdout lines via onLine callback", async () => {
		const lines: string[] = [];
		const spawnFn = vi
			.fn()
			.mockReturnValue(
				createMockProcess([
					'{"type":"init"}',
					'{"type":"message","text":"hi"}',
				]),
			);
		const pm = new ProcessManager(spawnFn);
		const handle = pm.spawn([]);
		handle.onLine((line) => lines.push(line));
		await handle.waitForExit();
		expect(lines).toEqual([
			'{"type":"init"}',
			'{"type":"message","text":"hi"}',
		]);
	});

	it("reports exit code via onExit callback", async () => {
		let code: number | null = null;
		const spawnFn = vi.fn().mockReturnValue(createMockProcess([], 42));
		const pm = new ProcessManager(spawnFn);
		const handle = pm.spawn([]);
		handle.onExit((c) => {
			code = c;
		});
		await handle.waitForExit();
		expect(code).toBe(42);
	});

	it("kill sends SIGTERM", () => {
		const mockProc = createMockProcess([], 0);
		const spawnFn = vi.fn().mockReturnValue(mockProc);
		const pm = new ProcessManager(spawnFn);
		const handle = pm.spawn([]);
		handle.kill();
		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("waitForExit resolves with exit code", async () => {
		const spawnFn = vi.fn().mockReturnValue(createMockProcess([], 0));
		const pm = new ProcessManager(spawnFn);
		const handle = pm.spawn([]);
		const code = await handle.waitForExit();
		expect(code).toBe(0);
	});
});
