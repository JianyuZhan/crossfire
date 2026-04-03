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
	const sendTurn = vi.fn(async (_handle, input) => {
		// Emit scripted events asynchronously
		setTimeout(() => {
			for (const e of scriptedEvents) {
				for (const l of listeners) l(e);
			}
		}, 0);
		return { turnId: input.turnId, status: "running" as const };
	});
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
		sendTurn,
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

		const result = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();

		expect(result.status).toBe("completed");
		expect(result.verdict).toBeDefined();
		expect(result.verdict?.leading).toBe("proposer");
		expect(result.verdict?.shouldContinue).toBe(true);
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

		const result = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();

		expect(result.status).toBe("completed");
		expect(result.verdict).toBeDefined();
		expect(result.verdict?.leading).toBe("challenger");
		expect(result.verdict?.score).toEqual({ proposer: 4, challenger: 8 });
		expect(result.verdict?.shouldContinue).toBe(false);
		expect(result.verdict?.reasoning).toBe("Stronger rebuttal");
	});

	it("returns undefined verdict when judge produces no verdict", async () => {
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

		const result = await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		unsub();
		expect(result.status).toBe("completed");
		expect(result.verdict).toBeUndefined();
	});

	it("runs judge turns in plan mode", async () => {
		const sendTurn = vi.fn(async (_handle, input) => ({
			turnId: input.turnId,
			status: "running" as const,
		}));
		const adapter: AgentAdapter = {
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
			sendTurn,
			onEvent() {
				return () => {};
			},
			async close() {},
		};
		const handle: SessionHandle = {
			adapterSessionId: "js1",
			providerSessionId: "ps1",
			adapterId: "claude",
			transcript: [],
		};
		const bus = new DebateEventBus();
		setTimeout(() => {
			bus.push({
				kind: "turn.completed",
				status: "completed",
				durationMs: 1,
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "js1",
				turnId: "j-1",
			});
		}, 0);

		await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
		});

		expect(sendTurn).toHaveBeenCalledWith(
			handle,
			expect.objectContaining({
				turnId: "j-1",
				executionMode: "plan",
				role: "judge",
				roundNumber: 1,
			}),
		);
	});

	it("passes policy and omits executionMode when policy is provided", async () => {
		const handle: SessionHandle = {
			adapterSessionId: "js1",
			providerSessionId: "ps1",
			adapterId: "claude",
			transcript: [],
		};
		const bus = new DebateEventBus();
		const sendTurn = vi.fn(async (_handle: unknown, _input: unknown) => {
			setTimeout(() => {
				bus.push({
					kind: "turn.completed",
					status: "completed",
					durationMs: 100,
					timestamp: Date.now(),
					adapterId: "claude",
					adapterSessionId: "js1",
					turnId: "j-1",
				} as NormalizedEvent);
			}, 0);
			return { turnId: "j-1", status: "running" as const };
		});
		const adapter: AgentAdapter = {
			id: "claude",
			capabilities: {} as any,
			async startSession() {
				return handle;
			},
			sendTurn,
			onEvent(cb) {
				return bus.subscribe(cb);
			},
			async close() {},
		};

		const fakePolicy = {
			preset: "plan" as const,
			roleContract: {
				semantics: {
					exploration: "forbidden" as const,
					factCheck: "minimal" as const,
					mayIntroduceNewProposal: false,
					evidenceBar: "high" as const,
				},
				ceilings: {},
			},
			capabilities: {
				filesystem: "read" as const,
				network: "search" as const,
				shell: "off" as const,
				subagents: "off" as const,
			},
			interaction: { approval: "always" as const },
		};

		await runJudgeTurn(adapter, handle, bus, {
			turnId: "j-1",
			prompt: "Judge this debate",
			roundNumber: 1,
			policy: fakePolicy,
		});

		const callArgs = sendTurn.mock.calls[0][1] as Record<string, unknown>;
		expect(callArgs.policy).toBe(fakePolicy);
		expect(callArgs.executionMode).toBeUndefined();
	});
});
