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

	it("supports approving all pending requests in one command", () => {
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

		const store = {
			getState: () => ({
				command: {
					pendingApprovals: [
						{
							requestId: "ar-1",
							adapterId: "claude",
							adapterSessionId: "claude-proposer",
							approvalType: "tool",
							title: "Approval 1",
						},
						{
							requestId: "ar-2",
							adapterId: "codex",
							adapterSessionId: "codex-challenger",
							approvalType: "command",
							title: "Approval 2",
						},
					],
				},
			}),
		} as TuiStore;

		const handler = createLiveCommandHandler({
			adapters,
			bus: { push: vi.fn() } as unknown as DebateEventBus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({ type: "approve", selector: { kind: "all" } });

		expect(proposerAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-1",
			decision: "allow",
		});
		expect(challengerAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-2",
			decision: "allow",
		});
	});

	it("supports approval by visible index", () => {
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

		const store = {
			getState: () => ({
				command: {
					pendingApprovals: [
						{
							requestId: "ar-1",
							adapterId: "claude",
							adapterSessionId: "claude-proposer",
							approvalType: "tool",
							title: "Approval 1",
						},
						{
							requestId: "ar-2",
							adapterId: "codex",
							adapterSessionId: "codex-challenger",
							approvalType: "command",
							title: "Approval 2",
						},
					],
				},
			}),
		} as TuiStore;

		const handler = createLiveCommandHandler({
			adapters,
			bus: { push: vi.fn() } as unknown as DebateEventBus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({ type: "deny", selector: { kind: "index", index: 2 } });

		expect(proposerAdapter.approve).not.toHaveBeenCalled();
		expect(challengerAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-2",
			decision: "deny",
		});
	});

	it("supports selecting a provider approval option by index", () => {
		const proposerAdapter = createMockAdapter("claude");

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposerAdapter,
				session: createSession("claude", "claude-proposer"),
			},
			challenger: {
				adapter: createMockAdapter("codex"),
				session: createSession("codex", "codex-challenger"),
			},
		};

		const store = {
			getState: () => ({
				command: {
					pendingApprovals: [
						{
							requestId: "ar-1",
							adapterId: "claude",
							adapterSessionId: "claude-proposer",
							approvalType: "tool",
							title: "Approval 1",
							options: [
								{
									id: "allow",
									label: "Allow once",
									kind: "allow",
									isDefault: true,
								},
								{
									id: "allow-session",
									label: "Allow for session",
									kind: "allow-always",
									scope: "session",
								},
								{
									id: "deny",
									label: "Reject",
									kind: "deny",
								},
							],
						},
					],
				},
			}),
		} as TuiStore;

		const handler = createLiveCommandHandler({
			adapters,
			bus: { push: vi.fn() } as unknown as DebateEventBus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({
			type: "approve",
			selector: { kind: "index", index: 1 },
			optionIndex: 2,
		});

		expect(proposerAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-1",
			decision: "allow-always",
			optionId: "allow-session",
		});
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

	it("emits pause, resume, and extend control events", () => {
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
		const bus = { push: vi.fn() } as unknown as DebateEventBus;
		const store = {
			getState: () => ({
				command: { pendingApprovals: [] },
				debateState: { config: { maxRounds: 5 } },
			}),
		} as TuiStore;
		const handler = createLiveCommandHandler({
			adapters,
			bus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({ type: "pause" });
		handler({ type: "resume" });
		handler({ type: "extend", rounds: 2 });

		expect(bus.push).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				kind: "debate.paused",
			}),
		);
		expect(bus.push).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: "debate.unpaused",
			}),
		);
		expect(bus.push).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				kind: "debate.extended",
				by: 2,
				newMaxRounds: 7,
			}),
		);
	});

	it("emits interrupt request events", () => {
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
		const bus = { push: vi.fn() } as unknown as DebateEventBus;
		const store = {
			getState: () => ({
				command: { pendingApprovals: [] },
				debateState: { config: { maxRounds: 5 } },
			}),
		} as TuiStore;
		const handler = createLiveCommandHandler({
			adapters,
			bus,
			store,
			triggerShutdown: vi.fn(),
		});

		handler({ type: "interrupt", target: "current" });
		handler({ type: "interrupt", target: "judge" });

		expect(bus.push).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				kind: "turn.interrupt.requested",
				target: "current",
			}),
		);
		expect(bus.push).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: "turn.interrupt.requested",
				target: "judge",
			}),
		);
	});
});
