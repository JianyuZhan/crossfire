import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { describe, expect, it } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";
import type { AdapterMap } from "../src/runner.js";
import { runDebate } from "../src/runner.js";

function createPromptCapturingAdapter(
	id: "claude" | "codex" | "gemini",
	scripts: Record<string, NormalizedEvent[]>,
	prompts: Map<string, string>,
): AgentAdapter {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	return {
		id,
		capabilities: {} as AgentAdapter["capabilities"],
		async startSession() {
			return {
				adapterSessionId: sessionId,
				providerSessionId: `p-${sessionId}`,
				adapterId: id,
				transcript: [],
			};
		},
		async sendTurn(_handle: SessionHandle, input: TurnInput) {
			prompts.set(input.turnId, input.prompt);
			const eventsForTurn = scripts[input.turnId] ?? [];
			setTimeout(() => {
				for (const event of eventsForTurn) {
					for (const listener of listeners) listener(event);
				}
			}, 0);
			return { turnId: input.turnId, status: "running" as const };
		},
		onEvent(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	};
}

function createControllableAdapter(
	id: "claude" | "codex" | "gemini",
	prompts: Map<string, string>,
): {
	adapter: AgentAdapter;
	emit(events: NormalizedEvent[]): void;
} {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	return {
		adapter: {
			id,
			capabilities: {} as AgentAdapter["capabilities"],
			async startSession() {
				return {
					adapterSessionId: sessionId,
					providerSessionId: `p-${sessionId}`,
					adapterId: id,
					transcript: [],
				};
			},
			async sendTurn(_handle: SessionHandle, input: TurnInput) {
				prompts.set(input.turnId, input.prompt);
				return { turnId: input.turnId, status: "running" as const };
			},
			onEvent(cb) {
				listeners.add(cb);
				return () => listeners.delete(cb);
			},
			async close() {},
		},
		emit(events: NormalizedEvent[]) {
			for (const event of events) {
				for (const listener of listeners) listener(event);
			}
		},
	};
}

function createInterruptibleAdapter(
	id: "claude" | "codex" | "gemini",
	prompts: Map<string, string>,
	options?: { supportsInterrupt?: boolean },
): {
	adapter: AgentAdapter;
	interruptCalls: string[];
} {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	let activeTurnId: string | undefined;
	const interruptCalls: string[] = [];
	const adapter = {
		id,
		capabilities: {} as AgentAdapter["capabilities"],
		async startSession() {
			return {
				adapterSessionId: sessionId,
				providerSessionId: `p-${sessionId}`,
				adapterId: id,
				transcript: [],
			};
		},
		async sendTurn(_handle: SessionHandle, input: TurnInput) {
			activeTurnId = input.turnId;
			prompts.set(input.turnId, input.prompt);
			return { turnId: input.turnId, status: "running" as const };
		},
		onEvent(cb: (e: NormalizedEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	} satisfies AgentAdapter;

	if (options?.supportsInterrupt !== false) {
		adapter.interrupt = async (turnId: string) => {
			interruptCalls.push(turnId);
			const effectiveTurnId = activeTurnId ?? turnId;
			for (const listener of listeners) {
				listener({
					kind: "turn.completed",
					status: "interrupted",
					durationMs: 10,
					timestamp: Date.now(),
					adapterId: id,
					adapterSessionId: sessionId,
					turnId: effectiveTurnId,
				});
			}
		};
	}

	return { adapter, interruptCalls };
}

function turnCompletedEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
): NormalizedEvent[] {
	return [
		{
			kind: "message.final",
			text: `${turnId} final`,
			role: "assistant",
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 10,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

describe("runDebate user injections", () => {
	it("applies proposer injections to the next proposer prompt", async () => {
		const config: DebateConfig = {
			topic: "Test topic",
			maxRounds: 2,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0,
		};
		const bus = new DebateEventBus();
		const proposerPrompts = new Map<string, string>();
		const challengerPrompts = new Map<string, string>();

		const proposer = createPromptCapturingAdapter(
			"claude",
			{
				"p-1": turnCompletedEvents("p-1", "claude", "claude-s1"),
				"p-2": turnCompletedEvents("p-2", "claude", "claude-s1"),
			},
			proposerPrompts,
		);
		const challenger = createPromptCapturingAdapter(
			"codex",
			{
				"c-1": turnCompletedEvents("c-1", "codex", "codex-s1"),
				"c-2": turnCompletedEvents("c-2", "codex", "codex-s1"),
			},
			challengerPrompts,
		);

		bus.subscribe((event) => {
			if (
				event.kind === "round.completed" &&
				event.roundNumber === 1 &&
				event.speaker === "challenger"
			) {
				bus.push({
					kind: "user.inject",
					target: "proposer",
					text: "Address operational risk explicitly.",
					priority: "normal",
					timestamp: Date.now(),
				});
			}
		});

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposer,
				session: await proposer.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
			challenger: {
				adapter: challenger,
				session: await challenger.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		await runDebate(config, adapters, { bus });

		expect(proposerPrompts.get("p-2")).toContain(
			"Address operational risk explicitly.",
		);
		expect(challengerPrompts.get("c-2")).not.toContain(
			"Address operational risk explicitly.",
		);
	});

	it("waits after the current turn when debate is paused", async () => {
		const config: DebateConfig = {
			topic: "Pause topic",
			maxRounds: 1,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0,
		};
		const bus = new DebateEventBus();
		const challengerTurnStarted: string[] = [];
		const proposerPrompts = new Map<string, string>();
		const proposer = createControllableAdapter("claude", proposerPrompts);

		const challengerPrompts = new Map<string, string>();
		const challenger = createPromptCapturingAdapter(
			"codex",
			{
				"c-1": turnCompletedEvents("c-1", "codex", "codex-s1"),
			},
			challengerPrompts,
		);
		const challengerSendTurn = challenger.sendTurn.bind(challenger);
		challenger.sendTurn = async (handle, input) => {
			challengerTurnStarted.push(input.turnId);
			return challengerSendTurn(handle, input);
		};

		bus.subscribe((event) => {
			if (event.kind === "round.started" && event.speaker === "proposer") {
				bus.push({ kind: "debate.paused", timestamp: Date.now() });
				setTimeout(() => {
					proposer.emit(turnCompletedEvents("p-1", "claude", "claude-s1"));
				}, 5);
			}
		});

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposer.adapter,
				session: await proposer.adapter.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
			challenger: {
				adapter: challenger,
				session: await challenger.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		const runPromise = runDebate(config, adapters, { bus });
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(challengerTurnStarted).toHaveLength(0);

		bus.push({ kind: "debate.unpaused", timestamp: Date.now() });
		await runPromise;
		expect(challengerTurnStarted).toEqual(["c-1"]);
	});

	it("continues beyond the original max rounds when debate is extended", async () => {
		const config: DebateConfig = {
			topic: "Extend topic",
			maxRounds: 1,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0,
		};
		const bus = new DebateEventBus();
		const proposerPrompts = new Map<string, string>();
		const challengerPrompts = new Map<string, string>();

		const proposer = createPromptCapturingAdapter(
			"claude",
			{
				"p-1": turnCompletedEvents("p-1", "claude", "claude-s1"),
				"p-2": turnCompletedEvents("p-2", "claude", "claude-s1"),
			},
			proposerPrompts,
		);
		const challenger = createPromptCapturingAdapter(
			"codex",
			{
				"c-1": turnCompletedEvents("c-1", "codex", "codex-s1"),
				"c-2": turnCompletedEvents("c-2", "codex", "codex-s1"),
			},
			challengerPrompts,
		);

		bus.subscribe((event) => {
			if (
				event.kind === "round.completed" &&
				event.roundNumber === 1 &&
				event.speaker === "challenger"
			) {
				bus.push({
					kind: "debate.extended",
					by: 1,
					newMaxRounds: 2,
					timestamp: Date.now(),
				});
			}
		});

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposer,
				session: await proposer.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
			challenger: {
				adapter: challenger,
				session: await challenger.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		await runDebate(config, adapters, { bus });

		expect(
			bus.getEvents().some((event) => event.kind === "debate.extended"),
		).toBe(true);
		expect(bus.snapshot().config.maxRounds).toBe(2);
		expect(proposerPrompts.has("p-2")).toBe(true);
		expect(challengerPrompts.has("c-2")).toBe(true);
	});

	it("interrupts the active turn and terminates the debate with interrupted reason", async () => {
		const config: DebateConfig = {
			topic: "Interrupt topic",
			maxRounds: 1,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0,
		};
		const bus = new DebateEventBus();
		const proposer = createInterruptibleAdapter("claude", new Map());
		const challenger = createPromptCapturingAdapter("codex", {}, new Map());

		bus.subscribe((event) => {
			if (event.kind === "round.started" && event.speaker === "proposer") {
				setTimeout(() => {
					bus.push({
						kind: "turn.interrupt.requested",
						target: "current",
						timestamp: Date.now(),
					});
				}, 0);
			}
		});

		const adapters: AdapterMap = {
			proposer: {
				adapter: proposer.adapter,
				session: await proposer.adapter.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
			challenger: {
				adapter: challenger,
				session: await challenger.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		const finalState = await runDebate(config, adapters, { bus });

		expect(proposer.interruptCalls).toEqual(["p-1"]);
		expect(finalState.terminationReason).toBe("interrupted");
		expect(
			bus
				.getEvents()
				.some(
					(event) =>
						event.kind === "debate.completed" &&
						(event as { reason?: string }).reason === "interrupted",
				),
		).toBe(true);
	});

	it("emits run.warning when interrupt is requested for an unsupported adapter", async () => {
		const config: DebateConfig = {
			topic: "Interrupt warning topic",
			maxRounds: 1,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0,
		};
		const bus = new DebateEventBus();
		const proposerPrompts = new Map<string, string>();
		const proposer = createControllableAdapter("gemini", proposerPrompts);
		const challenger = createPromptCapturingAdapter(
			"codex",
			{
				"c-1": turnCompletedEvents("c-1", "codex", "codex-s1"),
			},
			new Map(),
		);

		bus.subscribe((event) => {
			if (event.kind === "round.started" && event.speaker === "proposer") {
				setTimeout(() => {
					bus.push({
						kind: "turn.interrupt.requested",
						target: "proposer",
						timestamp: Date.now(),
					});
				}, 0);
				setTimeout(() => {
					proposer.emit(turnCompletedEvents("p-1", "gemini", "gemini-s1"));
				}, 5);
			}
		});
		const unsupportedAdapter = {
			...proposer.adapter,
			interrupt: undefined,
		};

		const adapters: AdapterMap = {
			proposer: {
				adapter: unsupportedAdapter,
				session: await unsupportedAdapter.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
			challenger: {
				adapter: challenger,
				session: await challenger.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		await runDebate(config, adapters, { bus });

		expect(
			bus
				.getEvents()
				.some(
					(event) =>
						event.kind === "run.warning" &&
						(event as { message?: string }).message?.includes(
							"does not support interrupt",
						),
				),
		).toBe(true);
	});
});
