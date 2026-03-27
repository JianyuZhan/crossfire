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

	it("tracks approval requests and switches command mode", () => {
		const store = new TuiStore();
		store.handleEvent(
			ev("approval.request", {
				requestId: "ar-1",
				adapterId: "claude",
				approvalType: "tool",
				title: "Allow Bash?",
				turnId: "p-1",
			}),
		);
		const s = store.getState();
		expect(s.command.mode).toBe("approval");
		expect(s.command.pendingApprovals).toHaveLength(1);
		expect(s.command.pendingApprovals[0].title).toBe("Allow Bash?");
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
});
