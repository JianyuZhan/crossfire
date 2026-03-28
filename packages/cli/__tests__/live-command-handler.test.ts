import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import type { AdapterMap, DebateEventBus } from "@crossfire/orchestrator";
import type { TuiStore } from "@crossfire/tui";
import { describe, expect, it, vi } from "vitest";
import { createLiveCommandHandler } from "../src/wiring/live-command-handler.js";

function createMockAdapter(id: "claude" | "codex" | "gemini") {
	return {
		id,
		capabilities: {} as AgentAdapter["capabilities"],
		startSession: vi.fn(),
		sendTurn: vi.fn(),
		onEvent: vi.fn(),
		close: vi.fn(),
		approve: vi.fn(),
	} satisfies AgentAdapter;
}

function createSession(
	adapterId: "claude" | "codex" | "gemini",
	adapterSessionId: string,
): SessionHandle {
	return {
		adapterId,
		adapterSessionId,
		providerSessionId: undefined,
		transcript: [],
	};
}

describe("createLiveCommandHandler", () => {
	it("routes approval by adapterSessionId instead of adapterId", () => {
		const proposerAdapter = createMockAdapter("claude");
		const challengerAdapter = createMockAdapter("codex");
		const judgeAdapter = createMockAdapter("claude");

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposerAdapter,
				session: createSession("claude", "claude-proposer"),
			},
			challenger: {
				adapter: challengerAdapter,
				session: createSession("codex", "codex-challenger"),
			},
			judge: {
				adapter: judgeAdapter,
				session: createSession("claude", "claude-judge"),
			},
		};

		const store = {
			getState: () => ({
				command: {
					pendingApprovals: [
						{
							requestId: "ar-judge",
							adapterId: "claude",
							adapterSessionId: "claude-judge",
							approvalType: "tool",
							title: "Judge approval",
						},
					],
				},
			}),
		} as TuiStore;

		const bus = { push: vi.fn() } as unknown as DebateEventBus;
		const triggerShutdown = vi.fn();
		const handler = createLiveCommandHandler({
			adapters,
			bus,
			store,
			triggerShutdown,
		});

		handler({ type: "approve" });

		expect(judgeAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-judge",
			decision: "allow",
		});
		expect(proposerAdapter.approve).not.toHaveBeenCalled();
		expect(challengerAdapter.approve).not.toHaveBeenCalled();
	});

	it("emits inject events for both proposer and challenger", () => {
		const proposerAdapter = createMockAdapter("claude");
		const challengerAdapter = createMockAdapter("codex");
		const adapters: AdapterMap = {
			proposer: {
				adapter: proposerAdapter,
				session: createSession("claude", "claude-proposer"),
			},
			challenger: {
				adapter: challengerAdapter,
				session: createSession("codex", "codex-challenger"),
			},
		};

		const bus = { push: vi.fn() } as unknown as DebateEventBus;
		const store = {
			getState: () => ({ command: { pendingApprovals: [] } }),
		} as TuiStore;

		const handler = createLiveCommandHandler({
			adapters,
			bus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({
			type: "inject",
			target: "both",
			text: "Focus on migration risk.",
			priority: "high",
		});

		expect(bus.push).toHaveBeenCalledTimes(2);
		expect(bus.push).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				kind: "user.inject",
				target: "proposer",
				text: "Focus on migration risk.",
				priority: "high",
			}),
		);
		expect(bus.push).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: "user.inject",
				target: "challenger",
				text: "Focus on migration risk.",
				priority: "high",
			}),
		);
	});

	it("treats stop as quit after debate completion", () => {
		const adapters: AdapterMap = {
			proposer: {
				adapter: createMockAdapter("claude"),
				session: createSession("claude", "claude-proposer"),
			},
			challenger: {
				adapter: createMockAdapter("codex"),
				session: createSession("codex", "codex-challenger"),
			},
		};
		const triggerShutdown = vi.fn();
		const quit = vi.fn();
		const handler = createLiveCommandHandler({
			adapters,
			bus: { push: vi.fn() } as unknown as DebateEventBus,
			store: {
				getState: () => ({ command: { pendingApprovals: [] } }),
			} as TuiStore,
			triggerShutdown,
			getUserQuitHandler: () => quit,
		});

		handler({ type: "stop" });

		expect(quit).toHaveBeenCalledTimes(1);
		expect(triggerShutdown).not.toHaveBeenCalled();
	});
});
