import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { describe, expect, it } from "vitest";
import { type AdapterMap, runDebate } from "../src/runner.js";

function createScriptedAdapter(
	id: "claude" | "codex" | "gemini",
	scripts: Record<string, NormalizedEvent[]>,
): AgentAdapter {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	return {
		id,
		capabilities: {} as any,
		async startSession() {
			return {
				adapterSessionId: sessionId,
				providerSessionId: `p-${sessionId}`,
				adapterId: id,
			};
		},
		async sendTurn(_handle: SessionHandle, input: TurnInput) {
			const eventsForTurn = scripts[input.turnId] ?? [
				// Unknown turnIds still complete immediately (prevents hangs in summary generation etc.)
				{
					kind: "turn.completed" as const,
					status: "completed" as const,
					durationMs: 0,
					timestamp: Date.now(),
					adapterId: id,
					adapterSessionId: sessionId,
					turnId: input.turnId,
				},
			];
			setTimeout(() => {
				for (const e of eventsForTurn) {
					for (const l of listeners) l(e);
				}
			}, 0);
			return { turnId: input.turnId, status: "running" as const };
		},
		onEvent(cb: (e: NormalizedEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	};
}

function turnEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
	content: string,
	meta: {
		stance: string;
		confidence: number;
		key_points: string[];
		wants_to_conclude?: boolean;
	},
): NormalizedEvent[] {
	return [
		{
			kind: "tool.call",
			toolUseId: `tu-${turnId}`,
			toolName: "debate_meta",
			input: meta,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "message.final",
			text: content,
			role: "assistant",
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

function judgeTurnEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
): NormalizedEvent[] {
	return [
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 50,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

const config: DebateConfig = {
	topic: "Test debate topic",
	maxRounds: 3,
	judgeEveryNRounds: 0,
	convergenceThreshold: 0.3,
};

describe("runDebate", () => {
	it("completes a simple 2-round debate with max-rounds termination", async () => {
		const smallConfig: DebateConfig = { ...config, maxRounds: 2 };

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer round 1", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Point A"],
			}),
			"p-2": turnEvents("p-2", "claude", "claude-s1", "Proposer round 2", {
				stance: "agree",
				confidence: 0.8,
				key_points: ["Point B"],
			}),
		});

		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger round 1", {
				stance: "strongly_disagree",
				confidence: 0.85,
				key_points: ["Counter A"],
			}),
			"c-2": turnEvents("c-2", "codex", "codex-s1", "Challenger round 2", {
				stance: "disagree",
				confidence: 0.75,
				key_points: ["Counter B"],
			}),
		});

		const judge = createScriptedAdapter("claude", {
			"j-1": judgeTurnEvents("j-1", "claude", "claude-s1"),
			"j-2": judgeTurnEvents("j-2", "claude", "claude-s1"),
			"j-final": judgeTurnEvents("j-final", "claude", "claude-s1"),
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
			judge: {
				adapter: judge,
				session: await judge.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		const result = await runDebate(smallConfig, adapters);
		expect(result.phase).toBe("completed");
		expect(result.terminationReason).toBe("max-rounds");
		expect(result.turns.length).toBeGreaterThanOrEqual(4);
	});

	it("terminates on convergence", async () => {
		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer converging", {
				stance: "neutral",
				confidence: 0.5,
				key_points: ["Agreed"],
				wants_to_conclude: true,
			}),
		});

		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger converging", {
				stance: "neutral",
				confidence: 0.5,
				key_points: ["Also agreed"],
				wants_to_conclude: true,
			}),
		});

		// No judge — convergence terminates directly when judge unavailable
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

		const result = await runDebate({ ...config, maxRounds: 10 }, adapters);
		expect(result.terminationReason).toBe("convergence");
		expect(result.turns).toHaveLength(2);
	});

	it("uses externally provided bus when given in options", async () => {
		const smallConfig: DebateConfig = { ...config, maxRounds: 1 };
		const { DebateEventBus } = await import("../src/event-bus.js");
		const externalBus = new DebateEventBus();

		const collected: AnyEvent[] = [];
		externalBus.subscribe((e) => collected.push(e));

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "agree",
				confidence: 0.7,
				key_points: ["A"],
				wants_to_conclude: true,
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "agree",
				confidence: 0.7,
				key_points: ["B"],
				wants_to_conclude: true,
			}),
		});
		const judge = createScriptedAdapter("claude", {
			"j-final": judgeTurnEvents("j-final", "claude", "claude-s1"),
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
			judge: {
				adapter: judge,
				session: await judge.startSession({
					profile: "test",
					workingDirectory: "/tmp",
				}),
			},
		};

		const result = await runDebate(smallConfig, adapters, { bus: externalBus });

		expect(result.phase).toBe("completed");
		expect(collected.some((e) => e.kind === "debate.started")).toBe(true);
		expect(collected.some((e) => e.kind === "debate.completed")).toBe(true);
	});

	it("completes debate without judge when judge is undefined", async () => {
		const noJudgeConfig: DebateConfig = { ...config, maxRounds: 2 };
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();

		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer round 1", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Point A"],
			}),
			"p-2": turnEvents("p-2", "claude", "claude-s1", "Proposer round 2", {
				stance: "agree",
				confidence: 0.8,
				key_points: ["Point B"],
			}),
		});

		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger round 1", {
				stance: "strongly_disagree",
				confidence: 0.85,
				key_points: ["Counter A"],
			}),
			"c-2": turnEvents("c-2", "codex", "codex-s1", "Challenger round 2", {
				stance: "disagree",
				confidence: 0.75,
				key_points: ["Counter B"],
			}),
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
			judge: undefined,
		};

		const result = await runDebate(noJudgeConfig, adapters, { bus });
		expect(result.phase).toBe("completed");
		expect(result.terminationReason).toBe("max-rounds");
		expect(result.turns.length).toBeGreaterThanOrEqual(4);
		// Verify no judge events were emitted
		expect(collected.some((e) => e.kind === "judge.started")).toBe(false);
		expect(collected.some((e) => e.kind === "judge.completed")).toBe(false);
	});

	it("resumes debate from given state", async () => {
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();

		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

		// Create a resumeState representing round 1 completed
		const resumeState: import("@crossfire/orchestrator-core").DebateState = {
			config: {
				topic: "test",
				maxRounds: 3,
				judgeEveryNRounds: 0,
				convergenceThreshold: 0.3,
			},
			phase: "completed",
			currentRound: 1,
			turns: [
				{
					roundNumber: 1,
					role: "proposer",
					content: "round 1 proposer",
					meta: {
						stance: "agree",
						confidence: 0.8,
						keyPoints: ["A"],
					},
				},
				{
					roundNumber: 1,
					role: "challenger",
					content: "round 1 challenger",
					meta: {
						stance: "disagree",
						confidence: 0.7,
						keyPoints: ["B"],
					},
				},
			],
			convergence: {
				converged: false,
				stanceDelta: 1.0,
				mutualConcessions: 0,
				bothWantToConclude: false,
			},
		};

		// Scripts for rounds 2-3
		const proposer = createScriptedAdapter("claude", {
			"p-2": turnEvents("p-2", "claude", "claude-s1", "Proposer round 2", {
				stance: "agree",
				confidence: 0.8,
				key_points: ["Point B"],
			}),
			"p-3": turnEvents("p-3", "claude", "claude-s1", "Proposer round 3", {
				stance: "neutral",
				confidence: 0.6,
				key_points: ["Point C"],
			}),
		});

		const challenger = createScriptedAdapter("codex", {
			"c-2": turnEvents("c-2", "codex", "codex-s1", "Challenger round 2", {
				stance: "disagree",
				confidence: 0.75,
				key_points: ["Counter B"],
			}),
			"c-3": turnEvents("c-3", "codex", "codex-s1", "Challenger round 3", {
				stance: "neutral",
				confidence: 0.65,
				key_points: ["Counter C"],
			}),
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

		const result = await runDebate(resumeState.config, adapters, {
			bus,
			resumeFromState: resumeState,
		});

		expect(result.phase).toBe("completed");
		// Should emit debate.resumed, not debate.started
		expect(collected[0].kind).toBe("debate.resumed");
		expect((collected[0] as any).fromRound).toBe(2);
		// Should NOT have debate.started
		expect(collected.some((e) => e.kind === "debate.started")).toBe(false);
		// Should have rounds 2 and 3
		expect(
			collected.some(
				(e) => e.kind === "round.started" && (e as any).roundNumber === 2,
			),
		).toBe(true);
		expect(
			collected.some(
				(e) => e.kind === "round.started" && (e as any).roundNumber === 3,
			),
		).toBe(true);
	});

	it("emits director.action events during debate", async () => {
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();
		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

		const smallConfig: DebateConfig = { ...config, maxRounds: 1 };
		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "agree",
				confidence: 0.7,
				key_points: ["A"],
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "disagree",
				confidence: 0.7,
				key_points: ["B"],
			}),
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

		await runDebate(smallConfig, adapters, { bus });
		const directorEvents = collected.filter(
			(e) => e.kind === "director.action",
		);
		expect(directorEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("writes action-plan.html and action-plan.md to outputDir", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crossfire-test-"));
		try {
			const smallConfig: DebateConfig = { ...config, maxRounds: 1 };
			const proposer = createScriptedAdapter("claude", {
				"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
					stance: "agree",
					confidence: 0.7,
					key_points: ["A"],
				}),
			});
			const challenger = createScriptedAdapter("codex", {
				"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
					stance: "disagree",
					confidence: 0.7,
					key_points: ["B"],
				}),
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

			await runDebate(smallConfig, adapters, { outputDir: tmpDir });
			expect(existsSync(join(tmpDir, "action-plan.html"))).toBe(true);
			expect(existsSync(join(tmpDir, "action-plan.md"))).toBe(true);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("action-plan.html contains all 6 sections", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crossfire-test-"));
		try {
			const smallConfig: DebateConfig = { ...config, maxRounds: 1 };
			const proposer = createScriptedAdapter("claude", {
				"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
					stance: "agree",
					confidence: 0.7,
					key_points: ["A"],
				}),
			});
			const challenger = createScriptedAdapter("codex", {
				"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
					stance: "disagree",
					confidence: 0.7,
					key_points: ["B"],
				}),
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

			await runDebate(smallConfig, adapters, { outputDir: tmpDir });
			const html = readFileSync(join(tmpDir, "action-plan.html"), "utf-8");
			expect(html).toContain("Executive Summary");
			expect(html).toContain("Consensus");
			expect(html).toContain("Unresolved");
			expect(html).toContain("Argument Evolution");
			expect(html).toContain("Risk Matrix");
			expect(html).toContain("Evidence Registry");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
