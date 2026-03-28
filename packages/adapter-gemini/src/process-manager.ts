import { type ChildProcess, spawn as defaultSpawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface ProcessHandle {
	pid: number | undefined;
	onLine(cb: (line: string) => void): void;
	onExit(cb: (code: number | null) => void): void;
	waitForExit(): Promise<number | null>;
	kill(): void;
}

type SpawnFn = (cmd: string, args: string[], options?: object) => ChildProcess;

export class ProcessManager {
	private readonly spawnFn: SpawnFn;

	constructor(spawnFn?: SpawnFn) {
		this.spawnFn = spawnFn ?? defaultSpawn;
	}

	spawn(args: string[]): ProcessHandle {
		const proc = this.spawnFn("gemini", args, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (!proc.stdout) {
			throw new Error("Failed to create stdout pipe for gemini process");
		}
		const rl = createInterface({ input: proc.stdout });

		const lineCallbacks: ((line: string) => void)[] = [];
		const exitCallbacks: ((code: number | null) => void)[] = [];
		let exitCode: number | null | undefined = undefined;
		let exitResolve: ((code: number | null) => void) | undefined;
		const exitPromise = new Promise<number | null>((resolve) => {
			exitResolve = resolve;
		});

		rl.on("line", (line) => {
			for (const cb of lineCallbacks) cb(line);
		});

		proc.on("exit", (code) => {
			exitCode = code;
			for (const cb of exitCallbacks) cb(code);
			exitResolve?.(code);
		});

		return {
			pid: proc.pid,
			onLine(cb) {
				lineCallbacks.push(cb);
			},
			onExit(cb) {
				if (exitCode !== undefined) cb(exitCode);
				else exitCallbacks.push(cb);
			},
			waitForExit: () => exitPromise,
			kill() {
				proc.kill("SIGTERM");
			},
		};
	}
}
