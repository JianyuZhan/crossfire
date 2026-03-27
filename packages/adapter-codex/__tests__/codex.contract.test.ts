import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import {
	type MockAdapterFactory,
	type ScenarioFixture,
	type ScenarioStep,
	runContractTests,
} from "@crossfire/adapter-core/testing";
import { CodexAdapter } from "../src/codex-adapter.js";
import { JsonRpcClient } from "../src/jsonrpc-client.js";

/**
 * Split fixture steps into per-turn groups.
 * Each group ends with either "turn-result" or "error".
 */
function splitByTurns(steps: ScenarioStep[]): ScenarioStep[][] {
	const turns: ScenarioStep[][] = [];
	let current: ScenarioStep[] = [];
	for (const step of steps) {
		current.push(step);
		if (step.kind === "turn-result" || step.kind === "error") {
			turns.push(current);
			current = [];
		}
	}
	if (current.length > 0) turns.push(current);
	return turns;
}

/** Defer execution to next tick, ensuring JsonRpcClient pending promises are set up */
function defer(): Promise<void> {
	return new Promise((r) => setImmediate(r));
}

function tick(ms = 5): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Creates a mock Codex app-server that intercepts JSON-RPC messages written by the
 * adapter's JsonRpcClient and replays ScenarioFixture steps as notifications/responses.
 *
 * CRITICAL: All responses must be deferred via setImmediate() because PassThrough
 * streams emit data synchronously. JsonRpcClient.request() writes BEFORE setting
 * up the pending resolve map entry. Without deferral, the response arrives before
 * the promise is registered and gets dropped.
 */
function createMockCodexServer(fixture: ScenarioFixture) {
	const adapterWritable = new PassThrough();
	const adapterReadable = new PassThrough();

	// The JsonRpcClient given to the adapter
	const client = new JsonRpcClient(adapterWritable, adapterReadable);

	const turnGroups = splitByTurns(fixture.steps);
	let sessionId = "mock-session";
	let turnIndex = 0;
	let closed = false;

	// Mock server reads what the adapter writes
	const mockRl = createInterface({ input: adapterWritable });

	mockRl.on("line", (line) => {
		if (closed) return;
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		const method = msg.method as string | undefined;
		const id = msg.id as number | undefined;

		if (method && id !== undefined) {
			// Request from adapter -- handle asynchronously
			void handleRequest(method, msg.params, id);
		}
		// Notifications from adapter (like "initialized") are ignored
	});

	/** Send a JSON-RPC response to the adapter (deferred) */
	async function sendResponse(id: number, result: unknown) {
		await defer();
		if (closed) return;
		adapterReadable.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
		);
	}

	/** Send a JSON-RPC notification to the adapter */
	function sendNotification(method: string, params: unknown) {
		if (closed) return;
		adapterReadable.write(
			`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
		);
	}

	let serverRequestId = 1000;
	/** Send a server-initiated JSON-RPC request to the adapter */
	function sendServerRequest(method: string, params: unknown): number {
		const id = serverRequestId++;
		if (closed) return id;
		adapterReadable.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
		);
		return id;
	}

	async function handleRequest(method: string, params: unknown, id: number) {
		switch (method) {
			case "initialize": {
				await sendResponse(id, { ok: true });
				break;
			}
			case "thread/start": {
				const sessionInit = fixture.steps.find(
					(s) => s.kind === "session-init",
				);
				if (sessionInit?.kind === "session-init") {
					sessionId = sessionInit.sessionId;
				}
				await sendResponse(id, { thread: { id: sessionId } });
				break;
			}
			case "turn/start": {
				const group = turnGroups[turnIndex] ?? [];
				turnIndex++;
				const nativeTurnId = `native-turn-${turnIndex}`;
				await sendResponse(id, {
					turn: { id: nativeTurnId, status: "running" },
				});
				// Replay steps after response is sent
				void replaySteps(group);
				break;
			}
			case "turn/interrupt": {
				await sendResponse(id, {});
				// Send turn/completed with interrupted status
				await tick(10);
				sendNotification("turn/completed", { status: "interrupted" });
				break;
			}
			default: {
				await sendResponse(id, {});
			}
		}
	}

	/**
	 * Replay scenario steps as JSON-RPC notifications/requests from the mock server.
	 */
	async function replaySteps(steps: ScenarioStep[]) {
		for (const step of steps) {
			if (closed) return;
			await tick();

			switch (step.kind) {
				case "session-init":
					// Already handled by thread/start response
					break;

				case "assistant-delta":
					sendNotification("item/agentMessage/delta", { text: step.text });
					break;

				case "thinking-delta":
					sendNotification("item/reasoning/summaryTextDelta", {
						text: step.text,
					});
					break;

				case "tool-call":
					sendNotification("item/started", {
						type: "commandExecution",
						id: step.toolUseId,
						command: step.toolName,
						...((step.input as object) ?? {}),
					});
					break;

				case "tool-result":
					sendNotification("item/completed", {
						type: "commandExecution",
						id: step.toolUseId,
						exitCode: step.success ? 0 : 1,
						output: step.output,
						error: step.success ? undefined : "Tool failed",
					});
					break;

				case "approval-request": {
					const approvalMethod =
						step.approvalType === "command"
							? "item/commandExecution/requestApproval"
							: step.approvalType === "file-change"
								? "item/fileChange/requestApproval"
								: "tool/requestUserInput";
					sendServerRequest(approvalMethod, {
						id: step.requestId,
						command: step.title,
					});
					// Wait for the contract test to call adapter.approve(),
					// which triggers the adapter to send a JSON-RPC response.
					// Poll the adapterWritable stream for the response.
					await waitForApprovalResponse();
					break;
				}

				case "approval-resolved":
					// Handled by approve() flow
					break;

				case "plan-updated":
					sendNotification("turn/plan/updated", {
						steps: step.steps.map((s) => ({
							step: s.description,
							status: s.status === "in_progress" ? "inProgress" : s.status,
						})),
					});
					break;

				case "turn-result": {
					if (step.usage) {
						sendNotification("thread/tokenUsage/updated", {
							inputTokens: step.usage.inputTokens,
							outputTokens: step.usage.outputTokens,
						});
						await tick();
					}
					sendNotification("turn/completed", { status: "completed" });
					break;
				}

				case "error": {
					if (closed) return;
					closed = true;
					// Trigger transport error via the client's error handler
					client.emitError(new Error(step.message));
					break;
				}

				case "warning":
					break;

				default:
					break;
			}
		}
	}

	/**
	 * Wait for the adapter to resolve the approval by sending a JSON-RPC response.
	 * The adapter's approve() calls resolveServerRequest which makes the JsonRpcClient
	 * write a response back. We detect this indirectly by waiting with polling.
	 */
	function waitForApprovalResponse(): Promise<void> {
		return new Promise<void>((resolve) => {
			// Wait for the contract test to call adapter.approve().
			// A simple polling approach with a generous timeout.
			let elapsed = 0;
			const interval = setInterval(() => {
				elapsed += 20;
				if (elapsed >= 3000 || closed) {
					clearInterval(interval);
					resolve();
				}
			}, 20);

			// Also listen for the response on adapterWritable
			const listener = (chunk: Buffer) => {
				const text = chunk.toString();
				// Check if this is a JSON-RPC response (has id but no method)
				try {
					const msg = JSON.parse(text.trim());
					if (msg.id !== undefined && msg.result !== undefined && !msg.method) {
						clearInterval(interval);
						adapterWritable.removeListener("data", listener);
						resolve();
					}
				} catch {
					// May be partial or not JSON
				}
			};
			adapterWritable.on("data", listener);
		});
	}

	function cleanup() {
		closed = true;
		try {
			mockRl.close();
		} catch {}
		try {
			client.close();
		} catch {}
		try {
			adapterWritable.destroy();
		} catch {}
		try {
			adapterReadable.destroy();
		} catch {}
	}

	return { client, cleanup };
}

/**
 * MockAdapterFactory for Codex contract tests.
 */
const factory: MockAdapterFactory = {
	capabilities: undefined,

	async create(fixture: ScenarioFixture) {
		const { client, cleanup } = createMockCodexServer(fixture);
		const adapter = new CodexAdapter({ client });
		(this as Record<string, unknown>)._cleanup = cleanup;
		return adapter;
	},

	async cleanup() {
		const cleanupFn = (this as Record<string, unknown>)._cleanup as
			| (() => void)
			| undefined;
		if (cleanupFn) cleanupFn();
	},
};

// Run the contract test suite
runContractTests("Codex", factory);
