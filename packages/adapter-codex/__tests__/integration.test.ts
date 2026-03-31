import { spawn } from "node:child_process";
import {
	collectEvents,
	waitForTurnCompleted,
} from "@crossfire/adapter-core/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { CodexAdapter } from "../src/codex-adapter.js";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const INTEGRATION_TIMEOUT_MS = 90000;
const TEST_MODEL = process.env.CODEX_MODEL || "gpt-5.4";

function spawnFn() {
	const proc = spawn("codex", ["app-server"], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	return {
		stdin: proc.stdin,
		stdout: proc.stdout,
	};
}

describe.skipIf(!RUN_INTEGRATION)("Codex integration", () => {
	let codexAvailable = false;

	beforeAll(async () => {
		// Pre-check: verify codex CLI is available by attempting to spawn it
		try {
			const testProc = spawn("codex", ["--version"], { stdio: "ignore" });
			await new Promise<void>((resolve, reject) => {
				testProc.on("error", () => reject());
				testProc.on("exit", () => resolve());
			});
			codexAvailable = true;
		} catch {
			codexAvailable = false;
		}
	});

	it(
		"smoke: single turn -> message.final -> turn.completed -> close",
		async () => {
			if (!codexAvailable) {
				console.warn("Skipping: codex CLI not found in PATH");
				return;
			}

			const adapter = new CodexAdapter({ spawnFn });
			const { events, unsubscribe } = collectEvents(adapter);

			try {
				// Start session
				const handle = await adapter.startSession({
					profile: "test",
					workingDirectory: process.cwd(),
					model: TEST_MODEL,
				});

				// Send a simple turn
				await adapter.sendTurn(handle, {
					turnId: "turn-1",
					prompt: "What is 2+2? Answer briefly.",
				});

				// Wait for turn completion with generous timeout
				await waitForTurnCompleted(events, "turn-1", 60000);

				// Assert: session.started was emitted
				const sessionStarted = events.find((e) => e.kind === "session.started");
				expect(sessionStarted).toBeDefined();

				// Assert: at least one message.delta
				const messageDeltas = events.filter((e) => e.kind === "message.delta");
				expect(messageDeltas.length).toBeGreaterThan(0);

				// Assert: message.final
				const messageFinal = events.find((e) => e.kind === "message.final");
				expect(messageFinal).toBeDefined();

				// Assert: turn.completed
				const turnCompleted = events.find(
					(e) => e.kind === "turn.completed" && e.turnId === "turn-1",
				);
				expect(turnCompleted).toBeDefined();
				expect(turnCompleted?.status).toBe("completed");

				// Close the session
				await adapter.close(handle);
			} finally {
				unsubscribe();
			}
		},
		INTEGRATION_TIMEOUT_MS,
	);

	it(
		"resume: second turn reuses session",
		async () => {
			if (!codexAvailable) {
				console.warn("Skipping: codex CLI not found in PATH");
				return;
			}

			const adapter = new CodexAdapter({ spawnFn });
			const { events, unsubscribe } = collectEvents(adapter);

			try {
				// Start session
				const handle = await adapter.startSession({
					profile: "test",
					workingDirectory: process.cwd(),
					model: TEST_MODEL,
				});

				// First turn
				await adapter.sendTurn(handle, {
					turnId: "turn-1",
					prompt: "Say 'hello'",
				});
				await waitForTurnCompleted(events, "turn-1", 60000);

				// Capture providerSessionId after first turn
				const firstProviderSessionId = handle.providerSessionId;
				expect(firstProviderSessionId).toBeDefined();

				// Second turn
				await adapter.sendTurn(handle, {
					turnId: "turn-2",
					prompt: "Say 'goodbye'",
				});
				await waitForTurnCompleted(events, "turn-2", 60000);

				// Assert: providerSessionId is consistent
				expect(handle.providerSessionId).toBe(firstProviderSessionId);

				// Close the session
				await adapter.close(handle);
			} finally {
				unsubscribe();
			}
		},
		INTEGRATION_TIMEOUT_MS * 2,
	);
});
