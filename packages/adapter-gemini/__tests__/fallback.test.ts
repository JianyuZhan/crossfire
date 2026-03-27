import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { NormalizedEvent } from "@crossfire/adapter-core";
import { describe, expect, it } from "vitest";
import { GeminiAdapter } from "../src/gemini-adapter.js";
import { ProcessManager } from "../src/process-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SpawnBehavior {
	lines: string[];
	exitCode: number;
	exitDelay?: number;
}

function createMockProcessManager(spawnBehaviors: SpawnBehavior[]): {
	pm: ProcessManager;
	spawnArgs: string[][];
	spawnCount: () => number;
} {
	let spawnIndex = 0;
	const spawnArgs: string[][] = [];

	const spawnFn = (_cmd: string, args: string[], _opts?: object) => {
		const behavior = spawnBehaviors[spawnIndex++];
		if (!behavior) {
			throw new Error("createMockProcessManager: no more spawn behaviors");
		}
		spawnArgs.push(args);

		const stdout = new PassThrough();
		const proc = new EventEmitter() as EventEmitter & {
			pid: number;
			stdout: PassThrough;
			kill: () => void;
		};
		proc.pid = 1000 + spawnIndex;
		proc.stdout = stdout;
		proc.kill = () => {
			stdout.end();
			proc.emit("exit", null);
		};

		setImmediate(() => {
			for (const line of behavior.lines) {
				stdout.write(`${line}\n`);
			}
			setTimeout(() => {
				stdout.end();
				proc.emit("exit", behavior.exitCode);
			}, behavior.exitDelay ?? 0);
		});

		return proc as any;
	};

	return {
		pm: new ProcessManager(spawnFn as any),
		spawnArgs,
		spawnCount: () => spawnIndex,
	};
}

function collectEvents(adapter: GeminiAdapter): {
	events: NormalizedEvent[];
	unsubscribe: () => void;
} {
	const events: NormalizedEvent[] = [];
	const unsubscribe = adapter.onEvent((e) => events.push(e));
	return { events, unsubscribe };
}

function waitForEvent(
	events: NormalizedEvent[],
	predicate: (e: NormalizedEvent) => boolean,
	timeoutMs = 3000,
): Promise<NormalizedEvent> {
	const found = events.find(predicate);
	if (found) return Promise.resolve(found);
	return new Promise((resolve, reject) => {
		const interval = setInterval(() => {
			const match = events.find(predicate);
			if (match) {
				clearInterval(interval);
				clearTimeout(timer);
				resolve(match);
			}
		}, 5);
		const timer = setTimeout(() => {
			clearInterval(interval);
			reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
		}, timeoutMs);
	});
}

function waitForTurnCompleted(events: NormalizedEvent[], turnId: string) {
	return waitForEvent(
		events,
		(e) => e.kind === "turn.completed" && e.turnId === turnId,
	);
}

function initLine(sessionId: string, model = "gemini-2.5-pro") {
	return JSON.stringify({
		type: "init",
		session_id: sessionId,
		model,
		tools: ["code_execution"],
	});
}

function messageLine(text: string) {
	return JSON.stringify({ type: "message", text });
}

function resultLine(durationMs = 100) {
	return JSON.stringify({
		type: "result",
		duration_ms: durationMs,
		usage: { input_tokens: 50, output_tokens: 20 },
	});
}

// ---------------------------------------------------------------------------
// A -> B Fallback State Machine Tests
// ---------------------------------------------------------------------------

describe("GeminiAdapter A->B fallback state machine", () => {
	describe("resume mismatch triggers fallback", () => {
		it("kills first process, spawns stateless, emits single turn.completed + run.warning", async () => {
			const { pm, spawnArgs, spawnCount } = createMockProcessManager([
				// Turn 1: initial session establishment
				{
					lines: [initLine("s1"), messageLine("first"), resultLine()],
					exitCode: 0,
				},
				// Turn 2, attempt A: resume returns wrong session_id
				{
					lines: [initLine("s2-wrong")],
					exitCode: 0,
					exitDelay: 50,
				},
				// Turn 2, attempt B: stateless fallback succeeds
				{
					lines: [initLine("s1"), messageLine("fallback ok"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Turn 1
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Turn 2 (with fallback)
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			// Should have spawned 3 processes total
			expect(spawnCount()).toBe(3);

			// The second spawn should have --resume s1
			expect(spawnArgs[1]).toContain("--resume");
			expect(spawnArgs[1]).toContain("s1");

			// The third spawn (fallback) should NOT have --resume
			expect(spawnArgs[2]).not.toContain("--resume");

			// Exactly one turn.completed for t2
			const t2Completions = events.filter(
				(e) => e.kind === "turn.completed" && e.turnId === "t2",
			);
			expect(t2Completions).toHaveLength(1);

			// Should have a run.warning about the fallback
			const warnings = events.filter(
				(e) => e.kind === "run.warning" && e.turnId === "t2",
			);
			expect(warnings.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("process crash during resume triggers fallback", () => {
		it("falls back to stateless and succeeds", async () => {
			const { pm, spawnCount } = createMockProcessManager([
				// Turn 1: establish session
				{
					lines: [initLine("s1"), resultLine()],
					exitCode: 0,
				},
				// Turn 2, attempt A: crashes (non-zero exit, no init event)
				{
					lines: [],
					exitCode: 1,
				},
				// Turn 2, attempt B: stateless fallback succeeds
				{
					lines: [initLine("s1"), messageLine("recovered"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Turn 1
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Turn 2
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			expect(spawnCount()).toBe(3);

			// Should have a warning about the fallback
			const warnings = events.filter(
				(e) => e.kind === "run.warning" && e.turnId === "t2",
			);
			expect(warnings.length).toBeGreaterThanOrEqual(1);

			// Turn t2 completed successfully
			const completed = events.find(
				(e) => e.kind === "turn.completed" && e.turnId === "t2",
			);
			expect(completed).toBeDefined();
			if (completed?.kind === "turn.completed") {
				expect(completed.status).toBe("completed");
			}
		});
	});

	describe("only one turn.completed per turn (guard)", () => {
		it("does not emit duplicate turn.completed even if result event comes before exit", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [initLine("s1"), messageLine("hi"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Wait a bit extra to ensure no delayed duplicate
			await new Promise((r) => setTimeout(r, 100));

			const completions = events.filter(
				(e) => e.kind === "turn.completed" && e.turnId === "t1",
			);
			expect(completions).toHaveLength(1);
		});
	});

	describe("intentionalKill: first process onExit ignored", () => {
		it("does not emit error/failure when killed process exits", async () => {
			const { pm } = createMockProcessManager([
				// Turn 1: establish session
				{
					lines: [initLine("s1"), resultLine()],
					exitCode: 0,
				},
				// Turn 2 attempt A: returns mismatched session (adapter kills it)
				{
					lines: [initLine("s2-mismatch")],
					exitCode: 0,
					exitDelay: 50,
				},
				// Turn 2 attempt B: stateless success
				{
					lines: [initLine("s1"), messageLine("ok"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Turn 1
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Turn 2 with fallback
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			// Wait for any delayed events
			await new Promise((r) => setTimeout(r, 100));

			// Should NOT have any run.error for the intentional kill
			const errors = events.filter(
				(e) => e.kind === "run.error" && e.turnId === "t2",
			);
			expect(errors).toHaveLength(0);

			// Exactly 1 turn.completed for t2
			const completions = events.filter(
				(e) => e.kind === "turn.completed" && e.turnId === "t2",
			);
			expect(completions).toHaveLength(1);
			if (completions[0]?.kind === "turn.completed") {
				expect(completions[0].status).toBe("completed");
			}
		});
	});

	describe("session.started not re-emitted on fallback", () => {
		it("emits session.started only once, not on B path", async () => {
			const { pm } = createMockProcessManager([
				// Turn 1: establish session -> emits session.started
				{
					lines: [initLine("s1"), resultLine()],
					exitCode: 0,
				},
				// Turn 2 attempt A: crash
				{
					lines: [],
					exitCode: 1,
				},
				// Turn 2 attempt B: stateless has init event with session_id
				// but session.started should NOT be re-emitted
				{
					lines: [initLine("s1"), messageLine("ok"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Turn 1
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Turn 2
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			// session.started should appear exactly once (from turn 1)
			const sessionEvents = events.filter((e) => e.kind === "session.started");
			expect(sessionEvents).toHaveLength(1);
		});
	});

	describe("first turn with no prior session: no fallback on crash", () => {
		it("first turn crash (no session to resume) emits failure, no fallback", async () => {
			const { pm, spawnCount } = createMockProcessManager([
				{ lines: [], exitCode: 1 },
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Only 1 spawn -- no fallback for first turn
			expect(spawnCount()).toBe(1);

			const completed = events.find(
				(e) => e.kind === "turn.completed" && e.turnId === "t1",
			);
			expect(completed).toBeDefined();
			if (completed?.kind === "turn.completed") {
				expect(completed.status).toBe("failed");
			}
		});
	});

	describe("messageBuffer reset between fallback attempts", () => {
		it("does not leak A partial buffer into B message.final", async () => {
			const { pm } = createMockProcessManager([
				// Turn 1: establish session
				{
					lines: [initLine("s1"), resultLine()],
					exitCode: 0,
				},
				// Turn 2 attempt A: partial message then crash
				{
					lines: [initLine("s1"), messageLine("partial-A-")],
					exitCode: 1,
				},
				// Turn 2 attempt B: clean start
				{
					lines: [initLine("s1"), messageLine("clean-B"), resultLine()],
					exitCode: 0,
				},
			]);

			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Turn 1
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Turn 2 with fallback
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			// The final message should be from B only, not contain A's partial
			const finals = events.filter(
				(e) => e.kind === "message.final" && e.turnId === "t2",
			);
			expect(finals).toHaveLength(1);
			if (finals[0]?.kind === "message.final") {
				expect(finals[0].text).toBe("clean-B");
				expect(finals[0].text).not.toContain("partial-A-");
			}
		});
	});
});
