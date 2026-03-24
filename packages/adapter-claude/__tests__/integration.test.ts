import {
	collectEvents,
	waitForTurnCompleted,
} from "@crossfire/adapter-core/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type { QueryFn } from "../src/claude-adapter.js";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!RUN_INTEGRATION)("Claude integration", () => {
	let realQueryFn: QueryFn | null = null;

	beforeAll(async () => {
		// Pre-check: verify @anthropic-ai/claude-agent-sdk is available
		try {
			const sdk = await import("@anthropic-ai/claude-agent-sdk");
			// Extract the query function from the SDK
			realQueryFn = sdk.query as QueryFn;
		} catch (err) {
			// SDK not available — tests will be skipped
			realQueryFn = null;
		}
	});

	it("smoke: single turn -> message.final -> turn.completed -> close", async () => {
		if (!realQueryFn) {
			console.warn("Skipping: @anthropic-ai/claude-agent-sdk not available");
			return;
		}

		const adapter = new ClaudeAdapter({ queryFn: realQueryFn });
		const { events, unsubscribe } = collectEvents(adapter);

		try {
			// Start session
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: process.cwd(),
				model: "haiku", // Cheapest model
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
	}, 60000);

	it("resume: second turn reuses session", async () => {
		if (!realQueryFn) {
			console.warn("Skipping: @anthropic-ai/claude-agent-sdk not available");
			return;
		}

		const adapter = new ClaudeAdapter({ queryFn: realQueryFn });
		const { events, unsubscribe } = collectEvents(adapter);

		try {
			// Start session
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: process.cwd(),
				model: "haiku",
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
	}, 120000);
});
