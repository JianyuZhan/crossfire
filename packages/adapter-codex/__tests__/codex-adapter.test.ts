import { PassThrough } from "node:stream";
import type { NormalizedEvent } from "@crossfire/adapter-core";
import { CODEX_CAPABILITIES } from "@crossfire/adapter-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/codex-adapter.js";
import { JsonRpcClient } from "../src/jsonrpc-client.js";

/**
 * Create a mock JsonRpcClient backed by PassThrough streams.
 * Returns the client plus the "server-side" streams for injecting messages.
 */
function createMockClient() {
	const clientToServer = new PassThrough(); // adapter writes here (stdin of child)
	const serverToClient = new PassThrough(); // server writes here (stdout of child)
	const client = new JsonRpcClient(clientToServer, serverToClient);

	// Helper: read and parse the next JSON-RPC message written by the adapter
	function readNextMessage(): Promise<Record<string, unknown>> {
		return new Promise((resolve) => {
			clientToServer.once("data", (data) => {
				resolve(JSON.parse(data.toString().trim()));
			});
		});
	}

	// Helper: send a JSON-RPC response from the "server"
	function sendResponse(id: number, result: unknown) {
		serverToClient.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
	}

	// Helper: send a JSON-RPC notification from the "server"
	function sendNotification(method: string, params: unknown) {
		serverToClient.write(
			`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
		);
	}

	// Helper: send a server-initiated JSON-RPC request (e.g., approval)
	function sendServerRequest(id: number, method: string, params: unknown) {
		serverToClient.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
		);
	}

	return {
		client,
		clientToServer,
		serverToClient,
		readNextMessage,
		sendResponse,
		sendNotification,
		sendServerRequest,
	};
}

/** Collect events from the adapter */
function collectEvents(adapter: CodexAdapter) {
	const events: NormalizedEvent[] = [];
	const unsubscribe = adapter.onEvent((e) => events.push(e));
	return { events, unsubscribe };
}

/** Wait for a specific event */
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

describe("CodexAdapter", () => {
	let mock: ReturnType<typeof createMockClient>;
	let adapter: CodexAdapter;

	beforeEach(() => {
		mock = createMockClient();
		adapter = new CodexAdapter({ client: mock.client });
	});

	afterEach(() => {
		mock.client.close();
	});

	describe("constructor and properties", () => {
		it("has id 'codex'", () => {
			expect(adapter.id).toBe("codex");
		});

		it("has CODEX_CAPABILITIES", () => {
			expect(adapter.capabilities).toEqual(CODEX_CAPABILITIES);
		});
	});

	describe("startSession()", () => {
		it("sends initialize, initialized, and thread/start requests", async () => {
			// Start the session call (it sends three messages)
			const sessionPromise = adapter.startSession({
				profile: "test-profile",
				workingDirectory: "/tmp/work",
				model: "o4-mini",
			});

			// 1. Read and respond to `initialize`
			const initMsg = await mock.readNextMessage();
			expect(initMsg.method).toBe("initialize");
			expect(initMsg.params).toEqual({
				clientInfo: {
					name: "crossfire",
					title: "Crossfire",
					version: "0.1.0",
				},
				capabilities: { experimentalApi: true },
			});
			mock.sendResponse(initMsg.id as number, { ok: true });

			// 2. Read the `initialized` notification
			const initializedMsg = await mock.readNextMessage();
			expect(initializedMsg.method).toBe("initialized");
			expect(initializedMsg.id).toBeUndefined();

			// 3. Read and respond to `thread/start`
			const threadStartMsg = await mock.readNextMessage();
			expect(threadStartMsg.method).toBe("thread/start");
			expect(threadStartMsg.params).toEqual({
				model: "o4-mini",
				cwd: "/tmp/work",
				approvalPolicy: "on-failure",
			});
			mock.sendResponse(threadStartMsg.id as number, {
				thread: { id: "thread-abc-123" },
			});

			const handle = await sessionPromise;
			expect(handle.adapterId).toBe("codex");
			expect(handle.providerSessionId).toBe("thread-abc-123");
			expect(handle.adapterSessionId).toMatch(/^codex-session-/);
		});

		it("returns unique adapterSessionIds", async () => {
			// First session
			const p1 = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			msg = await mock.readNextMessage(); // initialized
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "t1" } });
			const h1 = await p1;

			// Second session
			const p2 = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			msg = await mock.readNextMessage(); // initialized
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "t2" } });
			const h2 = await p2;

			expect(h1.adapterSessionId).not.toBe(h2.adapterSessionId);
		});

		it("maps research baseline to readOnly sandbox and on-request approval", async () => {
			const sessionPromise = adapter.startSession({
				profile: "test-profile",
				workingDirectory: "/tmp/work",
				model: "o4-mini",
				executionMode: "research",
			});

			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { ok: true });
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			expect(msg.method).toBe("thread/start");
			expect(msg.params).toEqual({
				model: "o4-mini",
				cwd: "/tmp/work",
				approvalPolicy: "on-request",
				sandboxPolicy: { type: "readOnly" },
			});
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-research" },
			});

			await sessionPromise;
		});

		it("does not pass profile as instructions to thread/start", async () => {
			const sessionPromise = adapter.startSession({
				profile: "You are a helpful assistant",
				workingDirectory: "/tmp",
				model: "o4-mini",
			});

			// initialize
			const msg1 = await mock.readNextMessage();
			mock.sendResponse(msg1.id as number, {});
			// initialized
			await mock.readNextMessage();
			// thread/start
			const threadMsg = await mock.readNextMessage();
			expect(threadMsg.params).not.toHaveProperty("instructions");
			mock.sendResponse(threadMsg.id as number, {
				thread: { id: "t1" },
			});
			await sessionPromise;
		});
	});

	describe("sendTurn()", () => {
		async function setupSession() {
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage(); // initialized
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			return sessionPromise;
		}

		it("sends turn/start and returns TurnHandle with status 'running'", async () => {
			const handle = await setupSession();

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "Hello world",
				turnId: "t1",
			});

			const turnMsg = await mock.readNextMessage();
			expect(turnMsg.method).toBe("turn/start");
			expect(turnMsg.params.threadId).toBe("thread-1");
			expect(turnMsg.params.approvalPolicy).toBe("on-failure");
			expect(turnMsg.params.input).toHaveLength(1);
			expect(turnMsg.params.input[0].type).toBe("text");
			expect(turnMsg.params.input[0].text).toContain("Hello world");
			expect(turnMsg.params.input[0].text).toContain("Meta-Tool Usage");
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-1", status: "running" },
			});

			const turnHandle = await turnPromise;
			expect(turnHandle.turnId).toBe("t1");
			expect(turnHandle.status).toBe("running");
		});

		it("maps per-turn dangerous override to never plus danger-full-access", async () => {
			const handle = await setupSession();

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "Ship it",
				turnId: "t1",
				executionMode: "dangerous",
			});

			const turnMsg = await mock.readNextMessage();
			expect(turnMsg.params.approvalPolicy).toBe("never");
			expect(turnMsg.params.sandboxPolicy).toEqual({
				type: "danger-full-access",
			});
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-1", status: "running" },
			});

			await turnPromise;
		});

		it("includes META_TOOL_INSTRUCTIONS on first turn only", async () => {
			const handle = await setupSession();

			// First turn - should include META_TOOL_INSTRUCTIONS
			const turn1Promise = adapter.sendTurn(handle, {
				prompt: "First turn",
				turnId: "t1",
			});
			const turn1Msg = await mock.readNextMessage();
			expect(turn1Msg.params.input[0].text).toContain("First turn");
			expect(turn1Msg.params.input[0].text).toContain("Meta-Tool Usage");
			mock.sendResponse(turn1Msg.id as number, {
				turn: { id: "native-turn-1", status: "running" },
			});
			await turn1Promise;

			// Second turn - should NOT include META_TOOL_INSTRUCTIONS
			const turn2Promise = adapter.sendTurn(handle, {
				prompt: "Second turn",
				turnId: "t2",
			});
			const turn2Msg = await mock.readNextMessage();
			expect(turn2Msg.params.input[0].text).toContain("Second turn");
			expect(turn2Msg.params.input[0].text).not.toContain("Meta-Tool Usage");
			mock.sendResponse(turn2Msg.id as number, {
				turn: { id: "native-turn-2", status: "running" },
			});
			await turn2Promise;
		});

		it("emits session.started event from startSession()", async () => {
			const { events } = collectEvents(adapter);
			const handle = await setupSession();

			const sessionStarted = events.find((e) => e.kind === "session.started");
			expect(sessionStarted).toBeDefined();
			if (sessionStarted?.kind === "session.started") {
				expect(sessionStarted.providerSessionId).toBe("thread-1");
				expect(sessionStarted.model).toBe("test-model");
				expect(sessionStarted.adapterId).toBe("codex");
			}
		});
	});

	describe("event flow via notifications", () => {
		async function setupSessionAndTurn() {
			const handle = await setupSessionHelper();
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "test",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;
			return handle;
		}

		async function setupSessionHelper() {
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			return sessionPromise;
		}

		it("routes notifications through mapCodexNotification and emits events", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			// Send a notification from the server
			mock.sendNotification("item/agentMessage/delta", { text: "Hello" });
			await new Promise((r) => setTimeout(r, 50));

			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas.length).toBeGreaterThan(0);
			if (deltas[0].kind === "message.delta") {
				expect(deltas[0].text).toBe("Hello");
				expect(deltas[0].turnId).toBe("t1");
			}
		});

		it("emits turn.completed from turn/completed notification", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("turn/completed", { status: "completed" });
			const completed = await waitForTurnCompleted(events, "t1");
			expect(completed.kind).toBe("turn.completed");
			if (completed.kind === "turn.completed") {
				expect(completed.status).toBe("completed");
			}
		});

		it("emits usage.updated from thread/tokenUsage/updated notification", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("thread/tokenUsage/updated", {
				inputTokens: 100,
				outputTokens: 50,
			});
			await new Promise((r) => setTimeout(r, 50));

			const usageEvents = events.filter((e) => e.kind === "usage.updated");
			expect(usageEvents.length).toBeGreaterThan(0);
		});

		it("includes cumulative_thread_total semantics in usage.updated events", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("thread/tokenUsage/updated", {
				tokenUsage: {
					total: {
						inputTokens: 100,
						outputTokens: 50,
					},
				},
			});
			await new Promise((r) => setTimeout(r, 50));

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.semantics).toBe("cumulative_thread_total");
				expect(usageEvent.inputTokens).toBe(100);
				expect(usageEvent.outputTokens).toBe(50);
			}
		});
	});

	describe("streaming: message.delta pipeline", () => {
		async function setupSessionAndTurn() {
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "test",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;
			return handle;
		}

		it("emits multiple message.delta events in order from item/agentMessage/delta", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("item/agentMessage/delta", { text: "Hello " });
			mock.sendNotification("item/agentMessage/delta", { text: "world" });
			mock.sendNotification("item/agentMessage/delta", { text: "!" });
			await new Promise((r) => setTimeout(r, 50));

			const deltas = events.filter((e) => e.kind === "message.delta");
			expect(deltas).toHaveLength(3);
			expect(deltas.map((d) => d.kind === "message.delta" && d.text)).toEqual([
				"Hello ",
				"world",
				"!",
			]);
		});

		it("message.delta events carry correct turnId", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("item/agentMessage/delta", { text: "chunk" });
			await new Promise((r) => setTimeout(r, 50));

			const delta = events.find((e) => e.kind === "message.delta");
			expect(delta).toBeDefined();
			if (delta?.kind === "message.delta") {
				expect(delta.turnId).toBe("t1");
				expect(delta.adapterId).toBe("codex");
			}
		});

		it("message.delta events arrive before turn/completed", async () => {
			const { events } = collectEvents(adapter);
			await setupSessionAndTurn();

			mock.sendNotification("item/agentMessage/delta", { text: "streaming" });
			mock.sendNotification("turn/completed", { status: "completed" });
			await waitForTurnCompleted(events, "t1");

			const deltaIdx = events.findIndex((e) => e.kind === "message.delta");
			const completedIdx = events.findIndex((e) => e.kind === "turn.completed");
			expect(deltaIdx).toBeGreaterThanOrEqual(0);
			expect(deltaIdx).toBeLessThan(completedIdx);
		});
	});

	describe("interrupt()", () => {
		it("sends turn/interrupt with correct threadId and turnId", async () => {
			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			// Send turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "long task",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-42", status: "running" },
			});
			await turnPromise;

			// Interrupt
			const interruptPromise = adapter.interrupt?.("t1");
			const interruptMsg = await mock.readNextMessage();
			expect(interruptMsg.method).toBe("turn/interrupt");
			expect(interruptMsg.params).toEqual({
				threadId: "thread-1",
				turnId: "native-turn-42",
			});
			mock.sendResponse(interruptMsg.id as number, {});
			await interruptPromise;
		});
	});

	describe("approval flow", () => {
		it("emits approval.request when server sends requestApproval, resolves on approve()", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			// Send turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "approve me",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			// Server sends approval request
			mock.sendServerRequest(99, "item/commandExecution/requestApproval", {
				command: "rm -rf /",
				id: "cmd1",
			});

			// Wait for approval.request event
			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");
			if (req.kind === "approval.request") {
				expect(req.approvalType).toBe("command");

				// Call approve
				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow",
				});
			}

			// Wait for approval.resolved event
			const resolved = await waitForEvent(
				events,
				(e) => e.kind === "approval.resolved",
			);
			expect(resolved.kind).toBe("approval.resolved");
			if (resolved.kind === "approval.resolved") {
				expect(resolved.decision).toBe("allow");
			}

			// Verify the adapter sent a JSON-RPC response back to the server
			const responseMsg = await mock.readNextMessage();
			expect(responseMsg.id).toBe(99);
			expect(responseMsg.result).toEqual({ approved: true });
		});

		it("preserves Codex native approval options and selected decision", async () => {
			const { events } = collectEvents(adapter);

			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "approve me",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			mock.sendServerRequest(100, "item/commandExecution/requestApproval", {
				command: "git push",
				id: "cmd1",
				availableDecisions: ["accept", "acceptForSession", "decline"],
			});

			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");
			if (req.kind === "approval.request") {
				expect(
					req.capabilities?.semanticOptions?.map((option) => option.id),
				).toEqual(["allow", "allow-session", "deny"]);
				expect(
					req.capabilities?.nativeOptions?.map((option) => option.id),
				).toEqual([
					"accept",
					"acceptForSession",
					"decline",
				]);
				expect(req.capabilities?.nativeOptions?.[1]).toMatchObject({
					kind: "allow-always",
					scope: "session",
				});

				await adapter.approve?.({
					requestId: req.requestId,
					decision: "allow-always",
					optionId: "acceptForSession",
				});
			}

			const responseMsg = await mock.readNextMessage();
			expect(responseMsg.id).toBe(100);
			expect(responseMsg.result).toEqual({ decision: "acceptForSession" });
		});

		it("handles fileChange approval requests", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "thread-1" } });
			const handle = await sessionPromise;

			// Send turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "edit file",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			// Server sends fileChange approval request
			mock.sendServerRequest(100, "item/fileChange/requestApproval", {
				path: "/tmp/file.ts",
			});

			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			if (req.kind === "approval.request") {
				expect(req.approvalType).toBe("file-change");
			}
		});

		it("handles user-input requests", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "thread-1" } });
			const handle = await sessionPromise;

			// Send turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "need input",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			// Server sends user-input request
			mock.sendServerRequest(101, "tool/requestUserInput", {
				prompt: "Enter value:",
			});

			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			if (req.kind === "approval.request") {
				expect(req.approvalType).toBe("user-input");
			}
		});
	});

	describe("close()", () => {
		it("calls client.close()", async () => {
			const closeSpy = vi.spyOn(mock.client, "close");
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "t1" } });
			const handle = await sessionPromise;

			await adapter.close(handle);
			expect(closeSpy).toHaveBeenCalled();
		});

		it("clears pending approvals for the session", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "thread-1" } });
			const handle = await sessionPromise;

			// Send turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "approve me",
				turnId: "t1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			// Server sends approval request
			mock.sendServerRequest(99, "item/commandExecution/requestApproval", {
				command: "rm -rf /",
				id: "cmd1",
			});

			// Wait for approval.request event
			const req = await waitForEvent(
				events,
				(e) => e.kind === "approval.request",
			);
			expect(req.kind).toBe("approval.request");

			// Close before approving
			await adapter.close(handle);

			// Attempt to approve should do nothing (cleaned up)
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

	describe("transcript tracking", () => {
		async function setupSessionHelper() {
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			return sessionPromise;
		}

		it("appends to transcript on message.final when turnId matches p-N pattern", async () => {
			const { events } = collectEvents(adapter);
			const handle = await setupSessionHelper();

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "test",
				turnId: "p-1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			// Send item/completed with agentMessage to trigger message.final
			mock.sendNotification("item/completed", {
				item: {
					type: "agentMessage",
					id: "msg1",
					content: [{ type: "text", text: "Proposer response" }],
				},
			});
			await new Promise((r) => setTimeout(r, 50));

			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0]).toEqual({
				roundNumber: 1,
				role: "proposer",
				content: "Proposer response",
			});
		});

		it("uses explicit role and roundNumber from TurnInput", async () => {
			const { events } = collectEvents(adapter);
			const handle = await setupSessionHelper();

			const turnPromise = adapter.sendTurn(handle, {
				prompt: "test",
				turnId: "custom-id",
				role: "judge",
				roundNumber: 5,
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-t1", status: "running" },
			});
			await turnPromise;

			mock.sendNotification("item/completed", {
				item: {
					type: "agentMessage",
					id: "msg1",
					content: [{ type: "text", text: "Judge verdict" }],
				},
			});
			await new Promise((r) => setTimeout(r, 50));

			expect(handle.transcript).toHaveLength(1);
			expect(handle.transcript[0].role).toBe("judge");
			expect(handle.transcript[0].roundNumber).toBe(5);
		});

		it("startSession initializes empty transcript", async () => {
			const handle = await setupSessionHelper();
			expect(handle.transcript).toEqual([]);
		});
	});

	describe("session recovery fallback", () => {
		it("recovers by creating a new thread when turn/start fails with thread-not-found and recoveryContext is set", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage(); // initialized
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			// Set recovery context
			handle.recoveryContext = {
				systemPrompt: "You are the proposer",
				topic: "Test topic",
				role: "proposer",
				maxRounds: 3,
				schemaType: "debate_meta",
			};

			// Add a transcript entry so recovery prompt includes content
			handle.transcript.push({
				roundNumber: 1,
				role: "proposer",
				content: "Previous argument",
			});

			// First turn: turn/start fails with thread-not-found error
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "new prompt",
				turnId: "p-2",
			});

			// Read the first turn/start attempt and respond with JSON-RPC error
			const turnMsg = await mock.readNextMessage();
			expect(turnMsg.method).toBe("turn/start");
			// Send a proper JSON-RPC error (not a result with error field)
			mock.serverToClient.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: turnMsg.id,
					error: { code: -32000, message: "thread not found" },
				})}\n`,
			);

			// Adapter should create a new thread, read thread/start
			const newThreadMsg = await mock.readNextMessage();
			expect(newThreadMsg.method).toBe("thread/start");
			mock.sendResponse(newThreadMsg.id as number, {
				thread: { id: "thread-2" },
			});

			// Then send turn/start on new thread
			const retryTurnMsg = await mock.readNextMessage();
			expect(retryTurnMsg.method).toBe("turn/start");
			expect(retryTurnMsg.params.threadId).toBe("thread-2");
			// Recovery prompt should contain topic and system prompt
			expect(retryTurnMsg.params.input[0].text).toContain("Test topic");
			expect(retryTurnMsg.params.input[0].text).toContain(
				"You are the proposer",
			);
			mock.sendResponse(retryTurnMsg.id as number, {
				turn: { id: "native-t-retry", status: "running" },
			});

			await turnPromise;

			// Provider session ID should be updated
			expect(handle.providerSessionId).toBe("thread-2");

			// A warning event should have been emitted
			const warnings = events.filter((e) => e.kind === "run.warning");
			expect(warnings.length).toBeGreaterThanOrEqual(1);
		});

		it("does not attempt recovery when no recoveryContext is set", async () => {
			const { events } = collectEvents(adapter);

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;
			// No recoveryContext set

			// Send turn - will fail
			const turnPromise = adapter.sendTurn(handle, {
				prompt: "new prompt",
				turnId: "p-2",
			});

			const turnMsg = await mock.readNextMessage();
			expect(turnMsg.method).toBe("turn/start");

			// Simulate server error by sending JSON-RPC error response
			mock.serverToClient.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: turnMsg.id,
					error: { code: -32000, message: "thread not found" },
				})}\n`,
			);

			// Should throw, not recover
			await expect(turnPromise).rejects.toThrow();
		});
	});

	describe("onEvent() / unsubscribe", () => {
		it("returns unsubscribe function that stops delivery", async () => {
			const { events, unsubscribe } = collectEvents(adapter);
			unsubscribe();

			// Setup session (events should NOT be delivered)
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, { thread: { id: "t1" } });
			await sessionPromise;

			expect(events).toHaveLength(0);
		});
	});

	describe("localMetrics in usage.updated", () => {
		it("attaches localMetrics to usage.updated events on first turn (with overhead)", async () => {
			const { events } = collectEvents(adapter);
			const testPrompt = "Hello world";

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			// Send first turn
			const turnPromise = adapter.sendTurn(handle, {
				prompt: testPrompt,
				turnId: "p-1",
			});
			const turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-1", status: "running" },
			});
			await turnPromise;

			// Simulate usage notification
			mock.sendNotification("thread/tokenUsage/updated", {
				inputTokens: 100,
				outputTokens: 50,
			});

			await waitForEvent(events, (e) => e.kind === "usage.updated", 1000);

			const usageEvent = events.find((e) => e.kind === "usage.updated");
			expect(usageEvent).toBeDefined();
			if (usageEvent?.kind === "usage.updated") {
				expect(usageEvent.localMetrics).toBeDefined();
				expect(usageEvent.localMetrics?.semanticChars).toBe(testPrompt.length);
				// First turn should have adapter overhead (META_TOOL_INSTRUCTIONS)
				expect(usageEvent.localMetrics?.adapterOverheadChars).toBeGreaterThan(
					0,
				);
				expect(usageEvent.localMetrics?.totalChars).toBeGreaterThan(
					testPrompt.length,
				);
			}
		});

		it("attaches localMetrics to usage.updated events on subsequent turns (no overhead)", async () => {
			const { events } = collectEvents(adapter);
			const testPrompt = "Follow up question";

			// Setup session
			const sessionPromise = adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
				model: "test-model",
			});
			let msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {});
			await mock.readNextMessage();
			msg = await mock.readNextMessage();
			mock.sendResponse(msg.id as number, {
				thread: { id: "thread-1" },
			});
			const handle = await sessionPromise;

			// Send first turn (to increment turnCount)
			let turnPromise = adapter.sendTurn(handle, {
				prompt: "First turn",
				turnId: "p-1",
			});
			let turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-1", status: "running" },
			});
			await turnPromise;

			// Emit turn.completed
			mock.serverToClient.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					method: "turn/completed",
					params: {
						turnId: "native-turn-1",
						status: "completed",
					},
				})}\n`,
			);

			await waitForEvent(
				events,
				(e) => e.kind === "turn.completed" && e.turnId === "p-1",
				1000,
			);

			// Send second turn
			turnPromise = adapter.sendTurn(handle, {
				prompt: testPrompt,
				turnId: "c-1",
			});
			turnMsg = await mock.readNextMessage();
			mock.sendResponse(turnMsg.id as number, {
				turn: { id: "native-turn-2", status: "running" },
			});
			await turnPromise;

			// Simulate usage notification for second turn
			mock.sendNotification("thread/tokenUsage/updated", {
				inputTokens: 150,
				outputTokens: 60,
			});

			await waitForEvent(
				events,
				(e) =>
					e.kind === "usage.updated" &&
					e.turnId === "c-1" &&
					e.inputTokens === 150,
				1000,
			);

			const usageEvents = events.filter((e) => e.kind === "usage.updated");
			const secondTurnUsage = usageEvents.find(
				(e) => e.turnId === "c-1" && e.inputTokens === 150,
			);
			expect(secondTurnUsage).toBeDefined();
			if (secondTurnUsage?.kind === "usage.updated") {
				expect(secondTurnUsage.localMetrics).toBeDefined();
				expect(secondTurnUsage.localMetrics?.semanticChars).toBe(
					testPrompt.length,
				);
				// Subsequent turns should have NO adapter overhead
				expect(secondTurnUsage.localMetrics?.adapterOverheadChars).toBe(0);
				expect(secondTurnUsage.localMetrics?.totalChars).toBe(
					testPrompt.length,
				);
			}
		});
	});
});
