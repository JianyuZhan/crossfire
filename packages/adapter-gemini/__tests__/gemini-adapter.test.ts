import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { NormalizedEvent } from "@crossfire/adapter-core";
import { GEMINI_CAPABILITIES } from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
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

/**
 * Creates a mock ProcessManager where each spawn() call replays the next
 * SpawnBehavior. Uses real PassThrough streams so ProcessManager's readline
 * integration works correctly.
 */
function createMockProcessManager(spawnBehaviors: SpawnBehavior[]): {
	pm: ProcessManager;
	spawnArgs: string[][];
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
		let killed = false;
		const proc = new EventEmitter() as EventEmitter & {
			pid: number;
			stdout: PassThrough;
			kill: () => void;
		};
		proc.pid = 1000 + spawnIndex;
		proc.stdout = stdout;
		proc.kill = () => {
			if (killed) return;
			killed = true;
			stdout.end();
			proc.emit("exit", null);
		};

		// Write lines then exit after a tick
		setImmediate(() => {
			if (killed) return;
			for (const line of behavior.lines) {
				if (killed) return;
				stdout.write(line + "\n");
			}
			setTimeout(() => {
				if (killed) return;
				killed = true;
				stdout.end();
				proc.emit("exit", behavior.exitCode);
			}, behavior.exitDelay ?? 0);
		});

		return proc as any;
	};

	return { pm: new ProcessManager(spawnFn as any), spawnArgs };
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

// JSONL line helpers
function initLine(sessionId: string, model = "gemini-2.5-pro") {
	return JSON.stringify({
		type: "init",
		session_id: sessionId,
		model,
		tools: ["code_execution", "file_edit"],
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
// Tests
// ---------------------------------------------------------------------------

describe("GeminiAdapter", () => {
	describe("constructor and properties", () => {
		it("has id 'gemini'", () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			expect(adapter.id).toBe("gemini");
		});

		it("has GEMINI_CAPABILITIES", () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			expect(adapter.capabilities).toEqual(GEMINI_CAPABILITIES);
		});

		it("does NOT have approve method", () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			expect((adapter as any).approve).toBeUndefined();
		});

		it("does NOT have interrupt method", () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			expect((adapter as any).interrupt).toBeUndefined();
		});
	});

	describe("startSession()", () => {
		it("returns handle with providerSessionId: undefined", async () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.providerSessionId).toBeUndefined();
		});

		it("returns handle with adapterId: 'gemini'", async () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.adapterId).toBe("gemini");
		});

		it("returns unique adapterSessionId", async () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const h1 = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			const h2 = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(h1.adapterSessionId).not.toBe(h2.adapterSessionId);
		});
	});

	describe("sendTurn()", () => {
		it("spawns process with correct args via ProcessManager", async () => {
			const { pm, spawnArgs } = createMockProcessManager([
				{
					lines: [initLine("s1"), messageLine("hello"), resultLine()],
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

			expect(spawnArgs.length).toBe(1);
			expect(spawnArgs[0]).toContain("-p");
			expect(spawnArgs[0]).toContain("hi");
			expect(spawnArgs[0]).toContain("--output-format");
			expect(spawnArgs[0]).toContain("stream-json");
		});

		it("returns TurnHandle immediately with status 'running'", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			const turnHandle = await adapter.sendTurn(handle, {
				prompt: "hi",
				turnId: "t1",
			});
			expect(turnHandle.turnId).toBe("t1");
			expect(turnHandle.status).toBe("running");
		});

		it("emits events correctly from stdout JSONL lines", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						messageLine("Hello "),
						messageLine("world"),
						resultLine(),
					],
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

			const sessionStarted = events.find((e) => e.kind === "session.started");
			expect(sessionStarted).toBeDefined();

			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas.length).toBe(2);

			const final = events.find((e) => e.kind === "message.final");
			expect(final).toBeDefined();
			if (final?.kind === "message.final") {
				expect(final.text).toBe("Hello world");
			}

			const completed = events.find((e) => e.kind === "turn.completed");
			expect(completed).toBeDefined();
		});

		it("session.started sets handle.providerSessionId", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("session-abc"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			expect(handle.providerSessionId).toBe("session-abc");
		});

		it("second turn uses --resume with providerSessionId", async () => {
			const { pm, spawnArgs } = createMockProcessManager([
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// First turn
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Second turn
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			// Second spawn should have --resume s1
			expect(spawnArgs[1]).toContain("--resume");
			expect(spawnArgs[1]).toContain("s1");
		});
	});

	describe("streaming: message.delta pipeline", () => {
		it("emits multiple message.delta events in order with correct text", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						messageLine("Hello "),
						messageLine("world"),
						messageLine("!"),
						resultLine(),
					],
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

			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas).toHaveLength(3);
			expect(deltas.map((d) => d.kind === "message.delta" && d.text)).toEqual([
				"Hello ",
				"world",
				"!",
			]);
		});

		it("message.final text equals concatenated deltas", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						messageLine("Part A "),
						messageLine("Part B"),
						resultLine(),
					],
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

			const final = events.find((e) => e.kind === "message.final");
			expect(final).toBeDefined();
			if (final?.kind === "message.final") {
				expect(final.text).toBe("Part A Part B");
			}
		});

		it("all message.delta events arrive before turn.completed", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						messageLine("chunk1"),
						messageLine("chunk2"),
						resultLine(),
					],
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

			const deltas = events.filter((e) => e.kind === "message.delta");
			const completedIdx = events.findIndex((e) => e.kind === "turn.completed");
			for (const delta of deltas) {
				const idx = events.indexOf(delta);
				expect(idx).toBeLessThan(completedIdx);
			}
		});
	});

	describe("transcript tracking", () => {
		it("appends to transcript on message.final when turnId matches p-N pattern", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						messageLine("Proposer argument"),
						resultLine(),
					],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "p-1" });
			await waitForTurnCompleted(events, "p-1");

			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0]).toEqual({
				roundNumber: 1,
				role: "proposer",
				content: "Proposer argument",
			});
		});

		it("uses explicit role and roundNumber from TurnInput", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [initLine("s1"), messageLine("Judge says"), resultLine()],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, {
				prompt: "judge",
				turnId: "custom-id",
				role: "judge",
				roundNumber: 3,
			});
			await waitForTurnCompleted(events, "custom-id");

			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0].role).toBe("judge");
			expect(handle.transcript[0].roundNumber).toBe(3);
		});

		it("accumulates transcript across multiple turns", async () => {
			const { pm } = createMockProcessManager([
				{
					lines: [initLine("s1"), messageLine("Turn 1"), resultLine()],
					exitCode: 0,
				},
				{
					lines: [initLine("s1"), messageLine("Turn 2"), resultLine()],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "p-1" });
			await waitForTurnCompleted(events, "p-1");

			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "c-2" });
			await waitForTurnCompleted(events, "c-2");

			expect(handle.transcript).toHaveLength(2);
			expect(handle.transcript[0].role).toBe("proposer");
			expect(handle.transcript[1].role).toBe("challenger");
		});

		it("startSession initializes empty transcript", async () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.transcript).toEqual([]);
		});
	});

	describe("session recovery fallback", () => {
		it("uses buildTranscriptRecoveryPrompt in Path B when recoveryContext is set", async () => {
			const { pm, spawnArgs } = createMockProcessManager([
				// First turn: succeeds (Path A)
				{
					lines: [initLine("s1"), messageLine("Turn 1"), resultLine()],
					exitCode: 0,
				},
				// Second turn Path A: resume fails (wrong session_id triggers fallback)
				{
					lines: [initLine("different-session")],
					exitCode: 0,
					exitDelay: 10,
				},
				// Second turn Path B: recovery with new session
				{
					lines: [
						initLine("s2"),
						messageLine("Recovered response"),
						resultLine(),
					],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Set recovery context
			handle.recoveryContext = {
				systemPrompt: "You are the proposer",
				topic: "Test topic for recovery",
				role: "proposer",
				maxRounds: 3,
				schemaType: "debate_meta",
			};

			// First turn succeeds
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "p-1" });
			await waitForTurnCompleted(events, "p-1");
			expect(handle.providerSessionId).toBe("s1");

			// Second turn: resume attempt fails (session mismatch), triggers Path B
			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "p-2" });
			await waitForTurnCompleted(events, "p-2");

			// Verify Path B used recovery prompt instead of stateless prompt
			// The third spawn (Path B) should have a prompt containing topic and system prompt
			expect(spawnArgs.length).toBe(3);
			const pathBArgs = spawnArgs[2];
			const promptArgIdx = pathBArgs.indexOf("-p");
			expect(promptArgIdx).toBeGreaterThanOrEqual(0);
			const recoveryPrompt = pathBArgs[promptArgIdx + 1];
			expect(recoveryPrompt).toContain("Test topic for recovery");
			expect(recoveryPrompt).toContain("You are the proposer");

			// Warning about fallback should be emitted
			const warnings = events.filter((e) => e.kind === "run.warning");
			expect(warnings.length).toBeGreaterThanOrEqual(1);
		});

		it("falls back to buildStatelessPrompt when no recoveryContext is set", async () => {
			const { pm, spawnArgs } = createMockProcessManager([
				// First turn: succeeds
				{
					lines: [initLine("s1"), messageLine("Turn 1"), resultLine()],
					exitCode: 0,
				},
				// Second turn Path A: resume fails
				{
					lines: [initLine("different-session")],
					exitCode: 0,
					exitDelay: 10,
				},
				// Second turn Path B: stateless fallback
				{
					lines: [
						initLine("s2"),
						messageLine("Fallback response"),
						resultLine(),
					],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			// No recoveryContext set

			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "p-1" });
			await waitForTurnCompleted(events, "p-1");

			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "p-2" });
			await waitForTurnCompleted(events, "p-2");

			// Path B should use stateless prompt (no topic/systemPrompt in prompt)
			expect(spawnArgs.length).toBe(3);
			const pathBArgs = spawnArgs[2];
			const promptArgIdx = pathBArgs.indexOf("-p");
			const fallbackPrompt = pathBArgs[promptArgIdx + 1];
			// Stateless prompt just has "Previous conversation:" + original prompt
			expect(fallbackPrompt).not.toContain("[SYSTEM PROMPT]");
			expect(fallbackPrompt).not.toContain("[TOPIC]");
		});
	});

	describe("close()", () => {
		it("kills running process", async () => {
			let killCalled = false;
			const stdout = new PassThrough();
			const proc = new EventEmitter() as EventEmitter & {
				pid: number;
				stdout: PassThrough;
				kill: () => void;
			};
			proc.pid = 9999;
			proc.stdout = stdout;
			proc.kill = () => {
				killCalled = true;
				stdout.end();
				proc.emit("exit", null);
			};

			// Emit init but never exit — long-running process
			setImmediate(() => {
				stdout.write(initLine("s1") + "\n");
			});

			const spawnFn = () => proc as any;
			const pm = new ProcessManager(spawnFn as any);
			const adapter = new GeminiAdapter({ processManager: pm });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			// Give it time to spawn and register
			await new Promise((r) => setTimeout(r, 50));
			await adapter.close(handle);
			expect(killCalled).toBe(true);
		});

		it("resolves without error when no process running", async () => {
			const { pm } = createMockProcessManager([]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await expect(adapter.close(handle)).resolves.not.toThrow();
		});

		it("removes session from sessions map", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// First turn succeeds
			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Close the session
			await adapter.close(handle);

			// Attempt to send another turn on closed session should fail or emit no events
			const eventsBefore = events.length;
			try {
				await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
				// If it doesn't throw, wait a bit
				await new Promise((r) => setTimeout(r, 100));
			} catch (err) {
				// Expected: session not found
				expect(err).toBeDefined();
			}

			// Either it threw or no turn.completed for t2
			const t2Completed = events.find(
				(e) => e.kind === "turn.completed" && e.turnId === "t2",
			);
			expect(t2Completed).toBeUndefined();
		});
	});

	describe("onEvent() / unsubscribe", () => {
		it("returns unsubscribe function that stops delivery", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events, unsubscribe } = collectEvents(adapter);
			unsubscribe();
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 100));
			expect(events).toHaveLength(0);
		});

		it("supports multiple subscribers", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("s1"), resultLine()], exitCode: 0 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const events1: NormalizedEvent[] = [];
			const events2: NormalizedEvent[] = [];
			adapter.onEvent((e) => events1.push(e));
			adapter.onEvent((e) => events2.push(e));
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await waitForEvent(events1, (e) => e.kind === "turn.completed");
			expect(events1.length).toBeGreaterThan(0);
			expect(events1.length).toBe(events2.length);
		});
	});

	describe("non-zero exit with no result event", () => {
		it("emits run.error and turn.completed with status 'failed'", async () => {
			const { pm } = createMockProcessManager([
				{ lines: [initLine("s1")], exitCode: 1 },
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hi", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const error = events.find((e) => e.kind === "run.error");
			expect(error).toBeDefined();

			const completed = events.find((e) => e.kind === "turn.completed");
			expect(completed).toBeDefined();
			if (completed?.kind === "turn.completed") {
				expect(completed.status).toBe("failed");
			}
		});
	});

	describe("localMetrics in usage.updated", () => {
		it("attaches localMetrics to usage.updated events", async () => {
			const testPrompt = "Hello Gemini world";
			const { pm } = createMockProcessManager([
				{
					lines: [
						initLine("s1"),
						JSON.stringify({ type: "message_delta", text: "Hi!" }),
						JSON.stringify({
							type: "usage",
							input_tokens: 100,
							output_tokens: 50,
						}),
						resultLine(),
					],
					exitCode: 0,
				},
			]);
			const adapter = new GeminiAdapter({ processManager: pm });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: testPrompt, turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.localMetrics).toBeDefined();
				expect(usageEvent.localMetrics?.semanticChars).toBe(testPrompt.length);
				// Gemini has no adapter overhead
				expect(usageEvent.localMetrics?.adapterOverheadChars).toBe(0);
				expect(usageEvent.localMetrics?.totalChars).toBe(testPrompt.length);
				expect(usageEvent.localMetrics?.semanticUtf8Bytes).toBeGreaterThan(0);
			}
		});
	});
});
