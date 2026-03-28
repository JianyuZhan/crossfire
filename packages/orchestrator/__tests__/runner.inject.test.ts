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
});
