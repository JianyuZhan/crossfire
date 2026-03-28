import { afterEach, describe, expect, it } from "vitest";
import type { AgentAdapter } from "../types.js";
import {
	assertCapabilitiesConsistent,
	assertEventOrder,
	collectEvents,
	waitForEvent,
	waitForTurnCompleted,
} from "./helpers.js";
import {
	APPROVAL_LIFECYCLE,
	HAPPY_PATH,
	MULTI_TURN,
	type ScenarioFixture,
	TOOL_FAILURE,
	TOOL_LIFECYCLE,
	TRANSPORT_ERROR,
} from "./scenarios.js";

export interface MockAdapterFactory {
	create(fixture: ScenarioFixture): Promise<AgentAdapter>;
	cleanup(): Promise<void>;
	capabilities?: import("../capabilities.js").AdapterCapabilities;
}

export function runContractTests(name: string, factory: MockAdapterFactory) {
	describe(`${name} adapter contract`, () => {
		let adapter: AgentAdapter;

		afterEach(async () => {
			await factory.cleanup();
		});

		it("happy path: session -> turn -> completion", async () => {
			adapter = await factory.create(HAPPY_PATH);
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
			assertEventOrder(events);
		});

		it("session.started emitted exactly once", async () => {
			adapter = await factory.create(HAPPY_PATH);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			const sessionEvents = events.filter((e) => e.kind === "session.started");
			expect(sessionEvents).toHaveLength(1);
		});

		it("turn.completed carries usage when available", async () => {
			adapter = await factory.create(HAPPY_PATH);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			const completed = await waitForTurnCompleted(events, "t1");
			if (completed.kind === "turn.completed" && completed.usage) {
				expect(completed.usage.inputTokens).toBeGreaterThan(0);
			}
		});

		it("tool lifecycle: tool.call -> tool.result matching toolUseId", async () => {
			adapter = await factory.create(TOOL_LIFECYCLE);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "use tool", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			const toolCalls = events.filter((e) => e.kind === "tool.call");
			const toolResults = events.filter((e) => e.kind === "tool.result");
			expect(toolCalls.length).toBeGreaterThan(0);
			expect(toolResults.length).toBeGreaterThan(0);
			if (
				toolCalls[0].kind === "tool.call" &&
				toolResults[0].kind === "tool.result"
			) {
				expect(toolCalls[0].toolUseId).toBe(toolResults[0].toolUseId);
			}
			assertEventOrder(events);
		});

		it("tool failure: tool.result with success=false", async () => {
			adapter = await factory.create(TOOL_FAILURE);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "bad tool", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			const failedResults = events.filter(
				(e) => e.kind === "tool.result" && !e.success,
			);
			expect(failedResults.length).toBeGreaterThan(0);
		});

		it("transport error: run.error emitted", async () => {
			adapter = await factory.create(TRANSPORT_ERROR);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter
				.sendTurn(handle, { prompt: "fail", turnId: "t1" })
				.catch(() => {});
			// Wait briefly for error event
			await new Promise((r) => setTimeout(r, 100));
			const errors = events.filter((e) => e.kind === "run.error");
			expect(errors.length).toBeGreaterThan(0);
		});

		it("multi-turn: no duplicate session.started", async () => {
			adapter = await factory.create(MULTI_TURN);
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
			assertEventOrder(events);
		});

		it("close resolves without error", async () => {
			adapter = await factory.create(HAPPY_PATH);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await expect(adapter.close(handle)).resolves.not.toThrow();
		});

		it("unsubscribe stops event delivery", async () => {
			adapter = await factory.create(HAPPY_PATH);
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

		it("capabilities consistent with events", async () => {
			adapter = await factory.create(HAPPY_PATH);
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "hello", turnId: "t1" });
			await waitForTurnCompleted(events, "t1");
			assertCapabilitiesConsistent(events, adapter.capabilities);
		});

		// -- Capability-gated: approval lifecycle --
		it("approval lifecycle (capability-gated)", async () => {
			adapter = await factory.create(APPROVAL_LIFECYCLE);
			if (!adapter.capabilities.supportsApproval) {
				expect(adapter.approve).toBeUndefined();
				return;
			}
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
			if (req.kind === "approval.request" && adapter.approve) {
				await adapter.approve({ requestId: req.requestId, decision: "allow" });
			}
			await waitForTurnCompleted(events, "t1");
			expect(events.filter((e) => e.kind === "approval.resolved")).toHaveLength(
				1,
			);
		});

		// -- Capability-gated: interrupt --
		it("interrupt (capability-gated)", async () => {
			adapter = await factory.create(HAPPY_PATH);
			if (!adapter.capabilities.supportsInterrupt) {
				expect(adapter.interrupt).toBeUndefined();
				return;
			}
			const { events } = collectEvents(adapter);
			const handle = await adapter.startSession({
				profile: "test",
				workingDirectory: "/tmp",
			});
			await adapter.sendTurn(handle, { prompt: "long task", turnId: "t1" });
			await adapter.interrupt?.("t1");
			const completed = await waitForTurnCompleted(events, "t1");
			if (completed.kind === "turn.completed") {
				expect(completed.status).toBe("interrupted");
			}
		});
	});
}
