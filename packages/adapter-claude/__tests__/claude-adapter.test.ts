import type { NormalizedEvent } from "@crossfire/adapter-core";
import { CLAUDE_CAPABILITIES } from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type { QueryFn, SdkMessage } from "../src/types.js";

// Helper: create an async generator from an array of SDK messages
async function* messagesFrom(
	msgs: SdkMessage[],
): AsyncGenerator<SdkMessage, void, unknown> {
	for (const msg of msgs) {
		yield msg;
	}
}

// Helper: create a mock queryFn that replays messages
function mockQueryFn(msgs: SdkMessage[]): {
	queryFn: QueryFn;
	interruptFn: ReturnType<typeof vi.fn>;
} {
	const interruptFn = vi.fn();
	const queryFn: QueryFn = () => ({
		messages: messagesFrom(msgs),
		interrupt: interruptFn,
	});
	return { queryFn, interruptFn };
}

// Collect events from the adapter
function collectEvents(adapter: ClaudeAdapter) {
	const events: NormalizedEvent[] = [];
	const unsubscribe = adapter.onEvent((e) => events.push(e));
	return { events, unsubscribe };
}

// Wait for a specific event to appear in the array
function waitForEvent(
	events: NormalizedEvent[],
	predicate: (e: NormalizedEvent) => boolean,
	timeoutMs = 2000,
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

describe("ClaudeAdapter", () => {
	let adapter: ClaudeAdapter;

	describe("constructor and properties", () => {
		it("has id 'claude'", () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			expect(adapter.id).toBe("claude");
		});

		it("has CLAUDE_CAPABILITIES", () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			expect(adapter.capabilities).toEqual(CLAUDE_CAPABILITIES);
		});
	});

	describe("startSession()", () => {
		it("returns handle with adapterId 'claude'", async () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.adapterId).toBe("claude");
		});

		it("returns handle with providerSessionId undefined", async () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.providerSessionId).toBeUndefined();
		});

		it("returns handle with a unique adapterSessionId", async () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
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
		it("returns a TurnHandle immediately with status 'running'", async () => {
			const msgs: SdkMessage[] = [
				{
					type: "system/init",
					sessionId: "ps1",
					model: "haiku",
					tools: ["bash"],
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			const turnHandle = await adapter.sendTurn(handle, {
				prompt: "hello",
				turnId: "t1",
			});
			expect(turnHandle.turnId).toBe("t1");
			expect(turnHandle.status).toBe("running");
		});

		it("maps research policy to dontAsk via policy translation", async () => {
			const { compilePolicy } = await import("@crossfire/adapter-core");
			const queryFn = vi.fn<QueryFn>(() => ({
				messages: messagesFrom([]),
				interrupt: vi.fn(),
			}));
			adapter = new ClaudeAdapter({ queryFn });
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				policy,
			});

			await adapter.sendTurn(handle, {
				prompt: "research",
				turnId: "t1",
				policy,
			});

			expect(queryFn).toHaveBeenCalledWith(
				expect.objectContaining({
					permissionMode: "default",
				}),
			);
		});

		it("maps dangerous policy to bypassPermissions", async () => {
			const { compilePolicy } = await import("@crossfire/adapter-core");
			const queryFn = vi.fn<QueryFn>(() => ({
				messages: messagesFrom([]),
				interrupt: vi.fn(),
			}));
			adapter = new ClaudeAdapter({ queryFn });
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				policy,
			});

			await adapter.sendTurn(handle, {
				prompt: "dangerous",
				turnId: "t1",
				policy,
			});

			expect(queryFn).toHaveBeenCalledWith(
				expect.objectContaining({
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
				}),
			);
		});

		it("maps plan policy to plan permission mode", async () => {
			const { compilePolicy } = await import("@crossfire/adapter-core");
			const queryFn = vi.fn<QueryFn>(() => ({
				messages: messagesFrom([]),
				interrupt: vi.fn(),
			}));
			adapter = new ClaudeAdapter({ queryFn });
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				policy,
			});

			await adapter.sendTurn(handle, {
				prompt: "plan",
				turnId: "t1",
				policy,
			});

			expect(queryFn).toHaveBeenCalledWith(
				expect.objectContaining({
					permissionMode: "plan",
				}),
			);
		});

		it("emits session.started from system/init", async () => {
			const msgs: SdkMessage[] = [
				{
					type: "system/init",
					sessionId: "ps1",
					model: "haiku",
					tools: ["bash"],
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			const sessionStarted = events.find((e) => e.kind === "session.started");
			expect(sessionStarted).toBeDefined();
			if (sessionStarted?.kind === "session.started") {
				expect(sessionStarted.providerSessionId).toBe("ps1");
				expect(sessionStarted.model).toBe("haiku");
			}
		});

		it("updates handle.providerSessionId from system/init", async () => {
			const msgs: SdkMessage[] = [
				{
					type: "system/init",
					sessionId: "ps1",
					model: "haiku",
					tools: ["bash"],
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			// Wait for the turn to complete so the handle is updated
			await new Promise((r) => setTimeout(r, 50));
			expect(handle.providerSessionId).toBe("ps1");
		});

		it("emits turn.completed with status 'completed'", async () => {
			const msgs: SdkMessage[] = [
				{
					type: "system/init",
					sessionId: "ps1",
					model: "haiku",
					tools: ["bash"],
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			const completed = await waitForTurnCompleted(events, "t1");
			expect(completed.kind).toBe("turn.completed");
			if (completed.kind === "turn.completed") {
				expect(completed.status).toBe("completed");
			}
		});

		it("emits message.delta events from stream", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hello" },
					},
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas.length).toBeGreaterThan(0);
		});

		it("passes resume parameter for subsequent turns", async () => {
			let callCount = 0;
			let lastResume: string | undefined;
			const queryFn: QueryFn = (opts) => {
				callCount++;
				lastResume = opts.resume;
				const msgs: SdkMessage[] =
					callCount === 1
						? [
								{
									type: "system/init",
									sessionId: "ps1",
									model: "haiku",
									tools: [],
								},
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 10, output_tokens: 5 },
									duration_ms: 100,
								},
							]
						: [
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 10, output_tokens: 5 },
									duration_ms: 100,
								},
							];
				return {
					messages: messagesFrom(msgs),
					interrupt: vi.fn(),
				};
			};
			adapter = new ClaudeAdapter({ queryFn });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 50));
			expect(lastResume).toBeUndefined();

			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await new Promise((r) => setTimeout(r, 50));
			expect(lastResume).toBe("ps1");
		});
	});

	describe("streaming: message.delta pipeline", () => {
		it("emits multiple message.delta events in order before turn.completed", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hello " },
					},
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "world" },
					},
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "!" },
					},
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas).toHaveLength(3);
			expect(deltas.map((d) => d.kind === "message.delta" && d.text)).toEqual([
				"Hello ",
				"world",
				"!",
			]);

			// All deltas arrive before turn.completed
			const turnCompletedIdx = events.findIndex(
				(e) => e.kind === "turn.completed",
			);
			const lastDeltaIdx = events.lastIndexOf(deltas[deltas.length - 1]);
			expect(lastDeltaIdx).toBeLessThan(turnCompletedIdx);
		});

		it("emits thinking.delta from content_block_delta with thinking_delta type", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "thinking_delta", thinking: "Let me think..." },
					},
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Answer" },
					},
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "think", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const thinkingDeltas = events.filter((e) => e.kind === "thinking.delta");
			expect(thinkingDeltas).toHaveLength(1);
			if (thinkingDeltas[0].kind === "thinking.delta") {
				expect(thinkingDeltas[0].text).toBe("Let me think...");
			}

			const msgDeltas = events.filter((e) => e.kind === "message.delta");
			expect(msgDeltas).toHaveLength(1);
		});
	});

	describe("multi-turn: no duplicate session.started", () => {
		it("only emits session.started once across turns", async () => {
			let callCount = 0;
			const queryFn: QueryFn = () => {
				callCount++;
				const msgs: SdkMessage[] =
					callCount === 1
						? [
								{
									type: "system/init",
									sessionId: "ps1",
									model: "haiku",
									tools: [],
								},
								{
									type: "stream_event",
									event: {
										type: "content_block_delta",
										delta: { type: "text_delta", text: "Turn 1" },
									},
								},
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 10, output_tokens: 5 },
									duration_ms: 100,
								},
							]
						: [
								{
									type: "stream_event",
									event: {
										type: "content_block_delta",
										delta: { type: "text_delta", text: "Turn 2" },
									},
								},
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 15, output_tokens: 8 },
									duration_ms: 200,
								},
							];
				return { messages: messagesFrom(msgs), interrupt: vi.fn() };
			};
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await waitForTurnCompleted(events, "t2");

			const sessionEvents = events.filter((e) => e.kind === "session.started");
			expect(sessionEvents).toHaveLength(1);
		});
	});

	describe("transport error", () => {
		it("emits run.error when async generator throws", async () => {
			const queryFn: QueryFn = () => {
				async function* throwingGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: [],
					};
					throw new Error("Connection lost");
				}
				return { messages: throwingGen(), interrupt: vi.fn() };
			};
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter
				.sendTurn(handle, { prompt: "fail", turnId: "t1" })
				.catch(() => {});
			await new Promise((r) => setTimeout(r, 100));
			const errors = events.filter((e) => e.kind === "run.error");
			expect(errors.length).toBeGreaterThan(0);
			if (errors[0].kind === "run.error") {
				expect(errors[0].message).toContain("Connection lost");
			}
		});
	});

	describe("onEvent() / unsubscribe", () => {
		it("returns unsubscribe function that stops delivery", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events, unsubscribe } = collectEvents(adapter);
			unsubscribe();
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 100));
			expect(events).toHaveLength(0);
		});

		it("supports multiple subscribers", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const events1: NormalizedEvent[] = [];
			const events2: NormalizedEvent[] = [];
			adapter.onEvent((e) => events1.push(e));
			adapter.onEvent((e) => events2.push(e));
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 100));
			expect(events1.length).toBeGreaterThan(0);
			expect(events1.length).toBe(events2.length);
		});
	});

	describe("close()", () => {
		it("resolves without error", async () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await expect(adapter.close(handle)).resolves.not.toThrow();
		});

		it("clears session-specific query context", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 50));
			await adapter.close(handle);
			// Should not throw on double close
			await expect(adapter.close(handle)).resolves.not.toThrow();
		});

		it("clears internal query context", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			// Close the session - this removes it from the queries map
			await adapter.close(handle);

			// Sending another turn will create a new query entry since the old one was removed
			// (The adapter doesn't throw on sendTurn for a closed session - it just starts fresh)
			const eventsBefore = events.length;
			await adapter.sendTurn(handle, { prompt: "after close", turnId: "t2" });
			await new Promise((r) => setTimeout(r, 100));

			// New turn events should be emitted (the session was cleared but a new query starts)
			const newEvents = events.slice(eventsBefore);
			expect(newEvents.length).toBeGreaterThan(0);
		});

		it("clears pending approvals", async () => {
			let canUseToolCalled = false;
			const queryFn: QueryFn = (opts) => {
				async function* approvalGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: ["bash"],
					};
					// Simulate approval request but don't complete it
					if (opts.canUseTool) {
						canUseToolCalled = true;
						// Don't await - leave it pending
						opts.canUseTool("bash", { command: "test" }, { toolUseID: "tu1" });
					}
					// Never send result - keep turn running
					await new Promise(() => {}); // Hang forever
				}
				return { messages: approvalGen(), interrupt: vi.fn() };
			};

			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, {
				prompt: "approve me",
				turnId: "t1",
			});

			// Wait for approval request
			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");

			// Close without resolving approval
			await adapter.close(handle);

			// Attempt to approve should do nothing (already cleaned up)
			if (req.kind === "approval.request") {
				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow",
				});
			}

			// No approval.resolved event should appear
			await new Promise((r) => setTimeout(r, 50));
			const resolved = events.filter((e) => e.kind === "approval.resolved");
			expect(resolved).toHaveLength(0);
		});
	});

	describe("interrupt()", () => {
		it("calls the query interrupt function", async () => {
			let interruptCalled = false;
			let resolveYield: (() => void) | undefined;
			const queryFn: QueryFn = () => {
				async function* slowGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: [],
					};
					// Pause here to allow interrupt to be called
					await new Promise<void>((r) => {
						resolveYield = r;
					});
					yield {
						type: "result",
						subtype: "success",
						usage: { input_tokens: 10, output_tokens: 5 },
						duration_ms: 100,
					};
				}
				return {
					messages: slowGen(),
					interrupt: () => {
						interruptCalled = true;
						// Resume the generator so it can complete
						resolveYield?.();
					},
				};
			};
			adapter = new ClaudeAdapter({ queryFn });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "long task", turnId: "t1" });
			// Wait briefly for the generator to start
			await new Promise((r) => setTimeout(r, 20));
			await adapter.interrupt?.("t1");
			expect(interruptCalled).toBe(true);
		});
	});

	describe("approve()", () => {
		it("resolves pending canUseTool promise", async () => {
			let canUseToolResolve: ((val: unknown) => void) | undefined;
			const queryFn: QueryFn = (opts) => {
				async function* approvalGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: ["bash"],
					};
					// Simulate the SDK calling canUseTool
					if (opts.canUseTool) {
						await opts.canUseTool(
							"bash",
							{ command: "rm -rf /" },
							{ toolUseID: "tu1" },
						);
					}
					yield {
						type: "result",
						subtype: "success",
						usage: { input_tokens: 10, output_tokens: 5 },
						duration_ms: 100,
					};
				}
				return { messages: approvalGen(), interrupt: vi.fn() };
			};

			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "approve me", turnId: "t1" });

			// Wait for approval.request to appear
			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");

			if (req.kind === "approval.request") {
				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow",
				});
			}

			// Wait for turn to complete
			await waitForTurnCompleted(events, "t1");
			const resolved = events.filter((e) => e.kind === "approval.resolved");
			expect(resolved).toHaveLength(1);
		});

		it("maps allow-always to updatedPermissions suggestions", async () => {
			let permissionResult:
				| {
						behavior: string;
						updatedInput?: Record<string, unknown>;
						updatedPermissions?: unknown[];
				  }
				| undefined;
			const suggestions = [
				{
					type: "addRules",
					behavior: "allow",
					destination: "session",
					rules: [{ toolName: "bash", ruleContent: "rm -rf /tmp/demo" }],
				},
			];
			const queryFn: QueryFn = (opts) => {
				async function* approvalGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: ["bash"],
					};
					if (opts.canUseTool) {
						permissionResult = (await opts.canUseTool(
							"bash",
							{ command: "rm -rf /tmp/demo" },
							{
								toolUseID: "tu1",
								suggestions,
								decisionReason: "command writes outside the sandbox",
							},
						)) as {
							behavior: string;
							updatedInput?: Record<string, unknown>;
							updatedPermissions?: unknown[];
						};
					}
					yield {
						type: "result",
						subtype: "success",
						usage: { input_tokens: 10, output_tokens: 5 },
						duration_ms: 100,
					};
				}
				return { messages: approvalGen(), interrupt: vi.fn() };
			};

			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "approve me", turnId: "t1" });

			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");
			if (req.kind === "approval.request") {
				expect(
					req.capabilities?.semanticOptions?.map((option) => option.id),
				).toEqual(["allow", "allow-session", "deny"]);
				expect(req.capabilities?.supportedScopes).toEqual(["session"]);
				expect(req.capabilities?.supportsUpdatedInput).toBe(true);
				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow-always",
					optionId: "allow-session",
				});
			}

			await waitForTurnCompleted(events, "t1");
			expect(permissionResult).toEqual({
				behavior: "allow",
				updatedInput: { command: "rm -rf /tmp/demo" },
				updatedPermissions: suggestions,
			});
		});

		it("synthesizes a session allow option when Claude suggestions are absent", async () => {
			let permissionResult:
				| {
						behavior: string;
						updatedInput?: Record<string, unknown>;
						updatedPermissions?: unknown[];
				  }
				| undefined;
			const queryFn: QueryFn = (opts) => {
				async function* approvalGen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: ["WebFetch"],
					};
					if (opts.canUseTool) {
						permissionResult = (await opts.canUseTool(
							"WebFetch",
							{
								url: "https://example.com",
								prompt: "Summarize this page",
							},
							{
								toolUseID: "tu1",
							},
						)) as {
							behavior: string;
							updatedInput?: Record<string, unknown>;
							updatedPermissions?: unknown[];
						};
					}
					yield {
						type: "result",
						subtype: "success",
						usage: { input_tokens: 10, output_tokens: 5 },
						duration_ms: 100,
					};
				}
				return { messages: approvalGen(), interrupt: vi.fn() };
			};

			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "approve me", turnId: "t1" });

			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");
			if (req.kind === "approval.request") {
				expect(
					req.capabilities?.semanticOptions?.map((option) => option.id),
				).toEqual(["allow", "allow-session", "deny"]);
				expect(req.capabilities?.supportedScopes).toEqual(["session"]);
				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow-always",
					optionId: "allow-session",
				});
			}

			await waitForTurnCompleted(events, "t1");
			expect(permissionResult).toEqual({
				behavior: "allow",
				updatedInput: {
					url: "https://example.com",
					prompt: "Summarize this page",
				},
				updatedPermissions: [
					{
						type: "addRules",
						behavior: "allow",
						destination: "session",
						rules: [{ toolName: "WebFetch" }],
					},
				],
			});
		});
	});

	describe("hooks integration via sendTurn", () => {
		it("passes hooks to queryFn", async () => {
			let receivedHooks: unknown;
			const queryFn: QueryFn = (opts) => {
				receivedHooks = opts.hooks;
				return {
					messages: messagesFrom([
						{
							type: "system/init",
							sessionId: "ps1",
							model: "haiku",
							tools: [],
						},
						{
							type: "result",
							subtype: "success",
							usage: { input_tokens: 10, output_tokens: 5 },
							duration_ms: 100,
						},
					]),
					interrupt: vi.fn(),
				};
			};
			adapter = new ClaudeAdapter({ queryFn });
			collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await new Promise((r) => setTimeout(r, 50));
			expect(receivedHooks).toBeDefined();
			expect(receivedHooks).toHaveProperty("PreToolUse");
			expect(receivedHooks).toHaveProperty("PostToolUse");
		});
	});

	describe("transcript tracking", () => {
		it("appends the latest non-empty final to transcript on turn completion when turnId matches p-N pattern", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{ type: "assistant", content: "Draft answer" },
				{ type: "assistant", content: "" },
				{ type: "assistant", content: "Hello world" },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "p-1" });
			await waitForTurnCompleted(events, "p-1");

			const finals = events.filter((event) => event.kind === "message.final");
			expect(finals).toHaveLength(2);
			expect(
				finals.every(
					(event) =>
						event.kind !== "message.final" || event.text.trim().length > 0,
				),
			).toBe(true);
			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0]).toEqual({
				roundNumber: 1,
				role: "proposer",
				content: "Hello world",
			});
		});

		it("does not append transcript before turn.completed", async () => {
			let release: (() => void) | undefined;
			const queryFn: QueryFn = () => ({
				messages: (async function* (): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: [],
					};
					yield { type: "assistant", content: "Partial answer" };
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				})(),
				interrupt: vi.fn(),
			});
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "p-1" });
			await new Promise((resolve) => setTimeout(resolve, 25));

			expect(handle.transcript).toEqual([]);

			release?.();
		});

		it("uses explicit role and roundNumber from TurnInput", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{ type: "assistant", content: "Challenger response" },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, {
				prompt: "challenge",
				turnId: "custom-id",
				role: "challenger",
				roundNumber: 3,
			});
			await waitForTurnCompleted(events, "custom-id");

			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0].role).toBe("challenger");
			expect(handle.transcript[0].roundNumber).toBe(3);
		});

		it("does not append to transcript when turnId does not match pattern and no explicit role", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{ type: "assistant", content: "Some text" },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 10, output_tokens: 5 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, {
				prompt: "hello",
				turnId: "unknown-format",
			});
			await waitForTurnCompleted(events, "unknown-format");

			expect(handle.transcript).toHaveLength(0);
		});

		it("accumulates transcript across multiple turns", async () => {
			let callCount = 0;
			const queryFn: QueryFn = () => {
				callCount++;
				const msgs: SdkMessage[] =
					callCount === 1
						? [
								{
									type: "system/init",
									sessionId: "ps1",
									model: "haiku",
									tools: [],
								},
								{ type: "assistant", content: "Turn 1 response" },
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 10, output_tokens: 5 },
									duration_ms: 100,
								},
							]
						: [
								{ type: "assistant", content: "Turn 2 response" },
								{
									type: "result",
									subtype: "success",
									usage: { input_tokens: 15, output_tokens: 8 },
									duration_ms: 200,
								},
							];
				return { messages: messagesFrom(msgs), interrupt: vi.fn() };
			};
			adapter = new ClaudeAdapter({ queryFn });
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
			expect(handle.transcript[0].roundNumber).toBe(1);
			expect(handle.transcript[1].role).toBe("challenger");
			expect(handle.transcript[1].roundNumber).toBe(2);
		});

		it("startSession initializes empty transcript", async () => {
			const { queryFn } = mockQueryFn([]);
			adapter = new ClaudeAdapter({ queryFn });
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			expect(handle.transcript).toEqual([]);
		});
	});

	describe("session recovery fallback", () => {
		it("does not trigger recovery when the stream errors after turn completion", async () => {
			let callCount = 0;
			const queryFn: QueryFn = () => {
				callCount++;
				async function* gen(): AsyncGenerator<SdkMessage> {
					yield {
						type: "system/init",
						sessionId: "ps1",
						model: "haiku",
						tools: [],
					};
					yield { type: "assistant", content: "Completed answer" };
					yield {
						type: "result",
						subtype: "success",
						usage: { input_tokens: 10, output_tokens: 5 },
						duration_ms: 100,
					};
					throw new Error("Claude Code process exited with code 1");
				}
				return { messages: gen(), interrupt: vi.fn() };
			};
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			handle.recoveryContext = {
				systemPrompt: "You are the proposer",
				topic: "Test topic",
				role: "proposer",
				maxRounds: 3,
				schemaType: "debate_meta",
			};

			await adapter.sendTurn(handle, {
				prompt: "initial prompt",
				turnId: "p-1",
			});
			await waitForTurnCompleted(events, "p-1");
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(callCount).toBe(1);
			expect(
				events.filter((event) => event.kind === "turn.completed"),
			).toHaveLength(1);
			expect(events.some((event) => event.kind === "run.warning")).toBe(false);
			expect(events.some((event) => event.kind === "run.error")).toBe(false);
			expect(handle.transcript).toHaveLength(1);
		});

		it("recovers by creating a new session when resume fails and recoveryContext is set", async () => {
			let callCount = 0;
			const capturedPrompts: string[] = [];
			const queryFn: QueryFn = (opts) => {
				callCount++;
				capturedPrompts.push(opts.prompt);
				if (callCount === 1) {
					// First turn: normal, sets providerSessionId
					return {
						messages: messagesFrom([
							{
								type: "system/init",
								sessionId: "ps1",
								model: "haiku",
								tools: [],
							},
							{ type: "assistant", content: "Turn 1 response" },
							{
								type: "result",
								subtype: "success",
								usage: { input_tokens: 10, output_tokens: 5 },
								duration_ms: 100,
							},
						]),
						interrupt: vi.fn(),
					};
				}
				if (callCount === 2) {
					// Second turn: resume fails (session expired)
					async function* failingGen(): AsyncGenerator<SdkMessage> {
						yield* [];
						throw new Error("session not found");
					}
					return { messages: failingGen(), interrupt: vi.fn() };
				}
				// Third call: recovery with new session
				return {
					messages: messagesFrom([
						{
							type: "system/init",
							sessionId: "ps2",
							model: "haiku",
							tools: [],
						},
						{ type: "assistant", content: "Recovered response" },
						{
							type: "result",
							subtype: "success",
							usage: { input_tokens: 20, output_tokens: 10 },
							duration_ms: 200,
						},
					]),
					interrupt: vi.fn(),
				};
			};
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});

			// Set recovery context
			handle.recoveryContext = {
				systemPrompt: "You are the proposer",
				topic: "Test topic",
				role: "proposer",
				maxRounds: 3,
				schemaType: "debate_meta",
			};

			// First turn succeeds and populates transcript
			await adapter.sendTurn(handle, {
				prompt: "initial prompt",
				turnId: "p-1",
			});
			await waitForTurnCompleted(events, "p-1");
			expect(handle.providerSessionId).toBe("ps1");

			// Second turn: resume fails, should trigger recovery
			await adapter.sendTurn(handle, {
				prompt: "turn 2 prompt",
				turnId: "p-2",
			});
			await waitForTurnCompleted(events, "p-2");

			// Verify recovery happened: 3 calls total (initial, failed resume, recovery)
			expect(callCount).toBe(3);

			// Recovery call should NOT use resume (new session)
			// The recovery prompt should contain transcript content
			const recoveryPrompt = capturedPrompts[2];
			expect(recoveryPrompt).toContain("Test topic");
			expect(recoveryPrompt).toContain("You are the proposer");

			// Provider session ID should be updated to new session
			expect(handle.providerSessionId).toBe("ps2");

			// run.warning should be emitted about recovery
			const warnings = events.filter((e) => e.kind === "run.warning");
			expect(warnings.length).toBeGreaterThanOrEqual(1);
			const recoveryWarning = warnings.find(
				(e) => e.kind === "run.warning" && e.message.includes("recovery"),
			);
			expect(recoveryWarning).toBeDefined();
		});

		it("emits run.error without recovery when no recoveryContext is set", async () => {
			let callCount = 0;
			const queryFn: QueryFn = () => {
				callCount++;
				if (callCount === 1) {
					return {
						messages: messagesFrom([
							{
								type: "system/init",
								sessionId: "ps1",
								model: "haiku",
								tools: [],
							},
							{
								type: "result",
								subtype: "success",
								usage: { input_tokens: 10, output_tokens: 5 },
								duration_ms: 100,
							},
						]),
						interrupt: vi.fn(),
					};
				}
				// Second call: resume fails
				async function* failingGen(): AsyncGenerator<SdkMessage> {
					yield* [];
					throw new Error("session not found");
				}
				return { messages: failingGen(), interrupt: vi.fn() };
			};
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			// No recoveryContext set

			await adapter.sendTurn(handle, { prompt: "turn 1", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			await adapter.sendTurn(handle, { prompt: "turn 2", turnId: "t2" });
			await new Promise((r) => setTimeout(r, 100));

			// Should emit run.error but NOT attempt recovery
			expect(callCount).toBe(2); // Only 2 calls, no recovery attempt
			const errors = events.filter((e) => e.kind === "run.error");
			expect(errors.length).toBeGreaterThan(0);
		});
	});

	describe("cache token extraction", () => {
		it("extracts cacheReadTokens and cacheWriteTokens from usage with snake_case fields", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_read_input_tokens: 80,
						cache_creation_input_tokens: 20,
					},
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "cached", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.cacheReadTokens).toBe(80);
				expect(usageEvent.cacheWriteTokens).toBe(20);
				expect(usageEvent.semantics).toBe("session_delta_or_cached");
			}
		});

		it("extracts cacheReadTokens and cacheWriteTokens from usage with camelCase fields", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: {
						inputTokens: 100,
						outputTokens: 50,
						cacheReadInputTokens: 80,
						cacheCreationInputTokens: 20,
					},
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "cached", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.cacheReadTokens).toBe(80);
				expect(usageEvent.cacheWriteTokens).toBe(20);
				expect(usageEvent.semantics).toBe("session_delta_or_cached");
			}
		});

		it("omits cacheReadTokens and cacheWriteTokens when not present", async () => {
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 100, output_tokens: 50 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "no cache", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.cacheReadTokens).toBeUndefined();
				expect(usageEvent.cacheWriteTokens).toBeUndefined();
				expect(usageEvent.semantics).toBe("session_delta_or_cached");
			}
		});
	});

	describe("localMetrics in usage.updated", () => {
		it("attaches localMetrics to usage.updated events", async () => {
			const testPrompt = "Hello world";
			const msgs: SdkMessage[] = [
				{ type: "system/init", sessionId: "ps1", model: "haiku", tools: [] },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hi!" },
					},
				},
				{
					type: "result",
					subtype: "success",
					usage: { input_tokens: 100, output_tokens: 50 },
					duration_ms: 100,
				},
			];
			const { queryFn } = mockQueryFn(msgs);
			adapter = new ClaudeAdapter({ queryFn });
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
				expect(usageEvent.localMetrics?.adapterOverheadChars).toBe(0);
				expect(usageEvent.localMetrics?.totalChars).toBe(testPrompt.length);
				expect(usageEvent.localMetrics?.semanticUtf8Bytes).toBeGreaterThan(0);
			}
		});
	});
});
