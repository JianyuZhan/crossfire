import type { ProviderObservationResult } from "@crossfire/adapter-core";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { describe, expect, it, vi } from "vitest";
import { TuiStore } from "../src/state/tui-store.js";

const BASE = {
	adapterId: "claude" as const,
	adapterSessionId: "s1",
	timestamp: Date.now(),
};

function ev(kind: string, extra: Record<string, unknown> = {}): AnyEvent {
	return { ...BASE, kind, ...extra } as AnyEvent;
}

const minimalConfig = {
	topic: "T",
	maxRounds: 3,
	judgeEveryNRounds: 0,
	convergenceThreshold: 0.3,
};

const stubObservation: ProviderObservationResult = {
	translation: {
		adapter: "claude",
		nativeSummary: {},
		exactFields: [],
		approximateFields: [],
		unsupportedFields: [],
	},
	toolView: [],
	capabilityEffects: [],
	warnings: [],
	completeness: "partial",
};

interface SnapshotWithThinking {
	thinkingText?: string;
	thinkingType?: string;
}

interface PanelWithSubagents {
	subagents?: Array<{
		subagentId: string;
		description?: string;
		status: "running" | "completed";
	}>;
}

type ProposerPanel = ReturnType<TuiStore["getState"]>["proposer"];

describe("TuiStore", () => {
	it("initializes with idle state", () => {
		const store = new TuiStore();
		const s = store.getState();
		expect(s.proposer.status).toBe("idle");
		expect(s.challenger.status).toBe("idle");
		expect(s.judge.visible).toBe(false);
	});

	it("updates proposer status on thinking.delta", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(ev("thinking.delta", { text: "Hmm...", turnId: "p-1" }));
		const s = store.getState();
		expect(s.proposer.status).toBe("thinking");
		expect(s.proposer.thinkingText).toContain("Hmm...");
	});

	it("accumulates message.delta and replaces on message.final", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(ev("message.delta", { text: "Hello ", turnId: "p-1" }));
		store.handleEvent(ev("message.delta", { text: "world", turnId: "p-1" }));
		expect(store.getState().proposer.currentMessageText).toBe("Hello world");
		expect(store.getState().proposer.status).toBe("speaking");
		store.handleEvent(
			ev("message.final", {
				text: "Hello world!",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.currentMessageText).toBe("Hello world!");
	});

	it("ignores empty message.final when visible text already exists", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Visible answer",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("message.final", {
				text: "",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.currentMessageText).toBe("Visible answer");
	});

	it("tracks tool calls and collapses on turn.completed", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "Read",
				input: { file: "a.ts" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.result", {
				toolUseId: "t1",
				toolName: "Read",
				success: true,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t2",
				toolName: "Edit",
				input: { file: "b.ts" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.result", {
				toolUseId: "t2",
				toolName: "Edit",
				success: true,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 500,
				turnId: "p-1",
			}),
		);
		const s = store.getState();
		expect(s.proposer.tools).toHaveLength(2);
		expect(s.proposer.tools[0].expanded).toBe(false);
		expect(s.proposer.tools[1].expanded).toBe(false);
		expect(s.proposer.status).toBe("done");
		expect(s.proposer.turnDurationMs).toBe(500);
	});

	it("records tool.call as requested and upgrades to running on tool.progress", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "Read",
				input: { file_path: "README.md" },
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.tools[0]?.status).toBe("requested");
		store.handleEvent(
			ev("tool.progress", {
				toolUseId: "t1",
				toolName: "Read",
				elapsedSeconds: 5,
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.tools[0]?.status).toBe("running");
		expect(store.getState().proposer.tools[0]?.elapsedMs).toBe(5000);
	});

	it("marks a denied Claude approval as denied before turn completion", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "toolu_123",
				toolName: "Read",
				input: { file_path: "README.md" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("approval.resolved", {
				requestId: "ar-p-1-toolu_123",
				decision: "deny",
				turnId: "p-1",
			}),
		);
		const tool = store.getState().proposer.tools[0];
		expect(tool?.status).toBe("denied");
		expect(tool?.resultSummary).toBe("denied");
	});

	it("marks tool.denied as denied", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "Read",
				input: { file_path: "README.md" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.denied", {
				toolUseId: "t1",
				toolName: "Read",
				input: { file_path: "README.md" },
				turnId: "p-1",
			}),
		);
		const tool = store.getState().proposer.tools[0];
		expect(tool?.status).toBe("denied");
		expect(tool?.resultSummary).toBe("denied");
	});

	it("closes unresolved tools as unknown when the turn completes", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "Read",
				input: { file_path: "README.md" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 500,
				turnId: "p-1",
			}),
		);
		const tool = store.getState().proposer.tools[0];
		expect(tool?.status).toBe("unknown");
		expect(tool?.resultSummary).toBe("unknown outcome");
	});

	it("retains tool error details for failure summaries", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "WebFetch",
				input: { url: "https://example.com/missing" },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.result", {
				toolUseId: "t1",
				toolName: "WebFetch",
				success: false,
				error: "Request failed with status code 404",
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.tools[0]?.resultSummary).toContain("404");
	});

	it("tracks the effective execution mode for the active role", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-1",
				config: minimalConfig,
			}),
		);
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("policy.turn.override", {
				role: "proposer",
				turnId: "p-1",
				preset: "plan",
				policy: {
					preset: "plan",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);
		expect(store.getState().proposer.preset).toBe("plan");
	});

	it("archives pre-tool narration into a persistent block", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Let me research this first.",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("tool.call", {
				toolUseId: "t1",
				toolName: "WebFetch",
				input: { url: "https://example.com" },
				turnId: "p-1",
			}),
		);
		const s = store.getState();
		expect(s.proposer.status).toBe("tool");
		expect(s.proposer.narrationTexts).toEqual(["Let me research this first."]);
		expect(s.proposer.currentMessageText).toBe("");
	});

	it("synthesizes elapsed time for running tools when the provider omits tool.progress", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));
		const store = new TuiStore();
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("tool.call", {
				timestamp: Date.now(),
				toolUseId: "t1",
				toolName: "WebFetch",
				input: { url: "https://example.com" },
				turnId: "p-1",
			}),
		);
		vi.advanceTimersByTime(2500);
		expect(store.getState().proposer.tools[0]?.elapsedMs).toBe(2500);
		store.dispose();
		vi.useRealTimers();
	});

	it("tracks approval requests and switches command mode", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("approval.request", {
				requestId: "ar-1",
				adapterId: "claude",
				adapterSessionId: "claude-session-1",
				approvalType: "tool",
				title: "Allow Bash?",
				payload: {
					tool_name: "Bash",
					tool_input: { command: "ls -la /tmp/somewhere" },
				},
				capabilities: {
					semanticOptions: [
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
					],
					supportedScopes: ["session"],
					supportsUpdatedInput: true,
				},
				turnId: "p-1",
			}),
		);
		const s = store.getState();
		expect(s.command.mode).toBe("approval");
		expect(s.command.pendingApprovals).toHaveLength(1);
		expect(s.command.pendingApprovals[0].title).toBe("Allow Bash?");
		expect(s.command.pendingApprovals[0].adapterSessionId).toBe(
			"claude-session-1",
		);
		expect(s.command.pendingApprovals[0].detail).toContain("Tool: Bash");
		expect(s.command.pendingApprovals[0].detail).toContain(
			"ls -la /tmp/somewhere",
		);
		expect(s.command.pendingApprovals[0].capabilities?.supportedScopes).toEqual(
			["session"],
		);
		expect(s.command.pendingApprovals[0].options).toHaveLength(2);
		expect(s.command.pendingApprovals[0].options?.[1]?.scope).toBe("session");
	});

	it("tracks live pause state and updated maxRounds", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(ev("debate.paused", {}));
		expect(store.getState().command.livePaused).toBe(true);

		store.handleEvent(
			ev("debate.extended", {
				by: 2,
				newMaxRounds: 5,
			}),
		);
		expect(store.getState().metrics.maxRounds).toBe(5);

		store.handleEvent(ev("debate.unpaused", {}));
		expect(store.getState().command.livePaused).toBe(false);
	});

	it("clears streaming buffers on new round.started", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("thinking.delta", { text: "thinking...", turnId: "p-1" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Round 1 msg",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 100,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "challenger" }),
		);
		const s = store.getState();
		expect(s.challenger.thinkingText).toBe("");
		expect(s.challenger.narrationTexts).toEqual([]);
		expect(s.challenger.currentMessageText).toBe("");
		expect(s.challenger.tools).toHaveLength(0);
	});

	it("updates metrics from usage.updated events", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 1000,
				outputTokens: 500,
				totalCostUsd: 0.05,
				turnId: "p-1",
			}),
		);
		const s = store.getState();
		expect(s.metrics.totalTokens).toBe(1500);
		expect(s.metrics.totalCostUsd).toBe(0.05);
	});

	it("caps thinkingText at 4KB", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		const chunk = "A".repeat(1024);
		for (let i = 0; i < 6; i++) {
			store.handleEvent(ev("thinking.delta", { text: chunk, turnId: "p-1" }));
		}
		expect(store.getState().proposer.thinkingText.length).toBeLessThanOrEqual(
			4096,
		);
	});

	it("retains thinking summary across speaking and into the round snapshot", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("thinking.delta", {
				text: "Break the problem into smaller steps.",
				thinkingType: "reasoning-summary",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Final answer",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.thinkingText).toContain(
			"Break the problem",
		);

		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 100,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);

		const snapshot = store.getState().rounds[0].proposer as
			| SnapshotWithThinking
			| undefined;
		expect(snapshot?.thinkingText).toContain("Break the problem");
		expect(snapshot?.thinkingType).toBe("reasoning-summary");
	});

	it("stores plan updates for the active speaker", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("plan.updated", {
				steps: [
					{ description: "Inspect files", status: "completed" },
					{ description: "Patch tests", status: "in_progress" },
				],
				turnId: "p-1",
			}),
		);
		expect(store.getState().proposer.latestPlan).toEqual([
			{ id: "step-0", title: "Inspect files", status: "completed" },
			{ id: "step-1", title: "Patch tests", status: "in_progress" },
		]);
	});

	it("tracks subagent lifecycle in live state and completed snapshots", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("subagent.started", {
				subagentId: "sa-1",
				description: "Research supporting evidence",
				turnId: "p-1",
			}),
		);
		let proposer = store.getState().proposer as ProposerPanel &
			PanelWithSubagents;
		expect(proposer.subagents).toEqual([
			{
				subagentId: "sa-1",
				description: "Research supporting evidence",
				status: "running",
			},
		]);

		store.handleEvent(
			ev("subagent.completed", {
				subagentId: "sa-1",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 100,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);

		proposer = store.getState().proposer as ProposerPanel & PanelWithSubagents;
		expect(proposer.subagents?.[0]?.status).toBe("completed");
		const snapshot = store.getState().rounds[0].proposer as
			| (SnapshotWithThinking & PanelWithSubagents)
			| undefined;
		expect(snapshot?.subagents).toEqual([
			{
				subagentId: "sa-1",
				description: "Research supporting evidence",
				status: "completed",
			},
		]);
	});

	it("fires subscriber callbacks on events", () => {
		vi.useFakeTimers();
		try {
			const store = new TuiStore();
			let callCount = 0;
			store.subscribe(() => {
				callCount++;
			});
			store.handleEvent(
				ev("debate.started", {
					config: {
						topic: "T",
						maxRounds: 1,
						judgeEveryNRounds: 0,
						convergenceThreshold: 0.3,
					},
				}),
			);
			// handleEvent now schedules a flush via setTimeout; advance timers to trigger it
			vi.advanceTimersByTime(20);
			expect(callCount).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows judge panel on judge.started", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 1,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(ev("judge.started", { roundNumber: 1 }));
		const s = store.getState();
		expect(s.judge.visible).toBe(true);
		expect(s.judge.judgeStatus).toBe("evaluating");
	});

	it("records judge verdict on judge.completed", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 1,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(ev("judge.started", { roundNumber: 1 }));
		store.handleEvent(
			ev("judge.completed", {
				roundNumber: 1,
				verdict: {
					leading: "proposer",
					score: { proposer: 7, challenger: 5 },
					reasoning: "Strong",
					shouldContinue: true,
				},
			}),
		);
		const s = store.getState();
		// judge stays visible as "done" until next round.started clears it
		expect(s.judge.judgeStatus).toBe("done");
		expect(s.judge.visible).toBe(true);
		expect(s.metrics.judgeVerdict).toEqual({
			shouldContinue: true,
			leading: "proposer",
		});

		// round.started clears the judge panel
		store.handleEvent(
			ev("round.started", { roundNumber: 2, speaker: "proposer" }),
		);
		const s2 = store.getState();
		expect(s2.judge.judgeStatus).toBe("idle");
		expect(s2.judge.visible).toBe(false);
	});

	it("snapshots agent turns into rounds on round.completed", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		// Proposer turn
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Proposer R1",
				role: "assistant",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 200,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);
		// Challenger turn
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "challenger" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: "Challenger R1",
				role: "assistant",
				turnId: "c-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 300,
				turnId: "c-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "challenger" }),
		);

		const s = store.getState();
		expect(s.rounds).toHaveLength(1);
		expect(s.rounds[0].roundNumber).toBe(1);
		expect(s.rounds[0].proposer?.messageText).toBe("Proposer R1");
		expect(s.rounds[0].proposer?.turnDurationMs).toBe(200);
		expect(s.rounds[0].challenger?.messageText).toBe("Challenger R1");
		expect(s.rounds[0].challenger?.turnDurationMs).toBe(300);
	});

	it("attributes usage to active speaker", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 500,
				outputTokens: 200,
				totalCostUsd: 0.03,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "challenger" }),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 800,
				outputTokens: 400,
				totalCostUsd: 0.05,
				turnId: "c-1",
			}),
		);

		const s = store.getState();
		expect(s.metrics.proposerUsage.tokens).toBe(700);
		expect(s.metrics.proposerUsage.costUsd).toBeCloseTo(0.03);
		expect(s.metrics.challengerUsage.tokens).toBe(1200);
		expect(s.metrics.challengerUsage.costUsd).toBeCloseTo(0.05);
		expect(s.metrics.totalTokens).toBe(1900);
	});

	it("populates judgeResults on judge events", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 3,
					judgeEveryNRounds: 1,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(ev("judge.started", { roundNumber: 1 }));
		expect(store.getState().judgeResults).toHaveLength(1);
		expect(store.getState().judgeResults[0].status).toBe("evaluating");

		store.handleEvent(
			ev("judge.completed", {
				roundNumber: 1,
				verdict: {
					leading: "proposer",
					score: { proposer: 7, challenger: 5 },
					reasoning: "Strong",
					shouldContinue: true,
				},
			}),
		);
		const s = store.getState();
		expect(s.judgeResults[0].status).toBe("done");
		expect(s.judgeResults[0].verdict?.leading).toBe("proposer");
	});

	it("strips debate_meta content from round snapshots", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("message.final", {
				text: 'My argument.\n```debate_meta\n{"stance":"agree"}\n```',
				role: "assistant",
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("turn.completed", {
				status: "completed",
				durationMs: 100,
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("round.completed", { roundNumber: 1, speaker: "proposer" }),
		);
		const s = store.getState();
		expect(s.rounds[0].proposer?.messageText).toBe("My argument.");
		expect(s.rounds[0].proposer?.messageText).not.toContain("debate_meta");
	});

	it("accumulates localMetrics from usage.updated events", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 500,
				outputTokens: 200,
				totalCostUsd: 0.03,
				localMetrics: { totalChars: 1200, totalUtf8Bytes: 1500 },
				turnId: "p-1",
			}),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 300,
				outputTokens: 100,
				totalCostUsd: 0.02,
				localMetrics: { totalChars: 800, totalUtf8Bytes: 1000 },
				turnId: "p-1",
			}),
		);

		const s = store.getState();
		expect(s.metrics.proposerUsage.localTotalChars).toBe(2000);
		expect(s.metrics.proposerUsage.localTotalUtf8Bytes).toBe(2500);
	});

	it("computes Codex delta from cumulative usage events", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		// First cumulative event
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 1000,
				outputTokens: 200,
				semantics: "cumulative_thread_total",
				turnId: "p-1",
			}),
		);
		// Second cumulative event
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 1500,
				outputTokens: 200,
				semantics: "cumulative_thread_total",
				turnId: "p-1",
			}),
		);

		const s = store.getState();
		expect(s.metrics.proposerUsage.previousCumulativeInput).toBe(1000);
		expect(s.metrics.proposerUsage.lastDeltaInput).toBe(500);
		expect(s.metrics.proposerUsage.tokens).toBe(1700); // (1000+200) first + (500+0) second = 1700
	});

	it("tracks Claude cache reads and observedInputPlusCacheRead", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				config: {
					topic: "T",
					maxRounds: 2,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
			}),
		);
		store.handleEvent(
			ev("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.handleEvent(
			ev("usage.updated", {
				inputTokens: 500,
				outputTokens: 200,
				cacheReadTokens: 3000,
				semantics: "session_delta_or_cached",
				turnId: "p-1",
			}),
		);

		const s = store.getState();
		expect(s.metrics.proposerUsage.cacheReadTokens).toBe(3000);
		expect(s.metrics.proposerUsage.observedInputPlusCacheRead).toBe(3500);
		expect(s.metrics.proposerUsage.tokens).toBe(700); // 500 input + 200 output
	});

	it("tracks RuntimePolicyState scoped to active session", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-1",
				config: minimalConfig,
			}),
		);
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);

		const s = store.getState();
		expect(s.policySession).toBeDefined();
		expect(s.policySession?.debateId).toBe("deb-1");
		expect(s.policySession?.roles.proposer).toBeDefined();
		expect(s.policySession?.roles.proposer.baseline.preset.value).toBe(
			"research",
		);
		expect(s.policySession?.roles.proposer.baseline.observation).toBe(
			stubObservation,
		);
	});

	it("resets policySession on new debate.started", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-1",
				config: minimalConfig,
			}),
		);
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);

		// New debate starts
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-2",
				config: minimalConfig,
			}),
		);

		const s = store.getState();
		expect(s.policySession?.debateId).toBe("deb-2");
		expect(s.policySession?.roles.proposer).toBeUndefined();
	});

	it("tracks policy.turn.override in session-scoped RuntimePolicyState", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-1",
				config: minimalConfig,
			}),
		);
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);
		store.handleEvent(
			ev("policy.turn.override", {
				role: "proposer",
				turnId: "turn-1",
				policy: {
					preset: "balanced",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				preset: "balanced",
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);

		const s = store.getState();
		expect(s.policySession?.roles.proposer.currentTurnOverride).toBeDefined();
		expect(s.policySession?.roles.proposer.currentTurnOverride?.turnId).toBe(
			"turn-1",
		);
		expect(s.policySession?.roles.proposer.currentTurnOverride?.preset).toBe(
			"balanced",
		);
	});

	it("clears policy.turn.override on clear event", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("debate.started", {
				debateId: "deb-1",
				config: minimalConfig,
			}),
		);
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);
		store.handleEvent(
			ev("policy.turn.override", {
				role: "proposer",
				turnId: "turn-1",
				policy: {
					preset: "balanced",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				preset: "balanced",
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);
		store.handleEvent(
			ev("policy.turn.override.clear", {
				turnId: "turn-1",
			}),
		);

		const s = store.getState();
		expect(s.policySession?.roles.proposer.currentTurnOverride).toBeUndefined();
		// preset must revert to baseline preset after override clear
		expect(store.getState().proposer.preset).toBe("research");
	});

	it("ignores policy events before debate.started", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("policy.baseline", {
				role: "proposer",
				policy: {
					preset: "research",
					roleContract: {},
					capabilities: {},
					interaction: {},
				},
				clamps: [],
				preset: { value: "research", source: "cli-role" },
				translationSummary: stubObservation.translation,
				warnings: [],
				observation: stubObservation,
			}),
		);

		const s = store.getState();
		expect(s.policySession).toBeUndefined();
	});
});
