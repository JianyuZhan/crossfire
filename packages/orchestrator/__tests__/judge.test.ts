import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import { DebateEventBus } from "../src/event-bus.js";
import { runJudgeTurn } from "../src/judge.js";

function makeMockAdapter(scriptedEvents: NormalizedEvent[]): AgentAdapter {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	return {
		id: "claude",
		capabilities: {} as any,
		async startSession() {
			return {
				adapterSessionId: "js1",
				providerSessionId: "ps1",
				adapterId: "claude",
				transcript: [],
			};
		},
		async sendTurn(_handle, input) {
			// Emit scripted events asynchronously
			setTimeout(() => {
				for (const e of scriptedEvents) {
					for (const l of listeners) l(e);
				}
			}, 0);
			return { turnId: input.turnId, status: "running" };
		},
		onEvent(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	};
}

describe("runJudgeTurn", () => {
	it("extracts verdict from judge events", async () => {
		const events: NormalizedEvent[] = [
			{
				kind: "tool.call",
				toolUseId: "j1",
				toolName: "judge_verdict",
				input: {
					leading: "proposer",
					score: { proposer: 7, challenger: 5 },
					reasoning: "Better evidence",
					should_continue: true,
				},
				timestamp: 1000,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
			{
				kind: "message.final",
				text: "My evaluation...",
				role: "assistant",
				timestamp: 1001,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 500,
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
		];

		const adapter = makeMockAdapter(events);
		const handle: SessionHandle = {
			adapterSessionId: "js1",
			providerSessionId: "ps1",
			adapterId: "claude",
			transcript: [],
		};
		const bus = new DebateEventBus();

		// Wire adapter into bus
		const unsub = adapter.onEvent((e) => bus.push(e));

		const verdict = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();

		expect(verdict).toBeDefined();
		expect(verdict!.leading).toBe("proposer");
		expect(verdict!.shouldContinue).toBe(true);
	});

	it("extracts verdict from fenced code block in message.final", async () => {
		const verdictJson = JSON.stringify({
			leading: "challenger",
			score: { proposer: 4, challenger: 8 },
			reasoning: "Stronger rebuttal",
			should_continue: false,
		});
		const events: NormalizedEvent[] = [
			{
				kind: "message.final",
				text: `My analysis:\n\n\`\`\`judge_verdict\n${verdictJson}\n\`\`\``,
				role: "assistant",
				timestamp: 1001,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 500,
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
		];

		const adapter = makeMockAdapter(events);
		const handle: SessionHandle = {
			adapterSessionId: "js1",
			providerSessionId: "ps1",
			adapterId: "claude",
			transcript: [],
		};
		const bus = new DebateEventBus();
		const unsub = adapter.onEvent((e) => bus.push(e));

		const verdict = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();

		expect(verdict).toBeDefined();
		expect(verdict!.leading).toBe("challenger");
		expect(verdict!.score).toEqual({ proposer: 4, challenger: 8 });
		expect(verdict!.shouldContinue).toBe(false);
		expect(verdict!.reasoning).toBe("Stronger rebuttal");
	});

	it("returns undefined when judge produces no verdict", async () => {
		const events: NormalizedEvent[] = [
			{
				kind: "message.final",
				text: "I cannot decide",
				role: "assistant",
				timestamp: 1001,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 500,
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			},
		];

		const adapter = makeMockAdapter(events);
		const handle: SessionHandle = {
			adapterSessionId: "js1",
			providerSessionId: "ps1",
			adapterId: "claude",
			transcript: [],
		};
		const bus = new DebateEventBus();
		const unsub = adapter.onEvent((e) => bus.push(e));

		const verdict = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();
		expect(verdict).toBeUndefined();
	});
});
