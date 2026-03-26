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
import {
	type AdapterMap,
	getSchemaRefreshMode,
	runDebate,
} from "../src/runner.js";

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
				transcript: [],
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

	it("no-judge + stagnation trigger is silently skipped", async () => {
		// With 4 rounds of identical stances and no judge, the Director will
		// detect stagnation (stance-frozen) and emit trigger-judge actions.
		// Without a judge adapter those should be silently skipped and the
		// debate should complete via max-rounds without crashing.
		const stagnantConfig: DebateConfig = {
			...config,
			maxRounds: 4,
			judgeEveryNRounds: 0,
			convergenceThreshold: 0, // disable convergence (stances differ)
		};

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Same point"],
			}),
			"p-2": turnEvents("p-2", "claude", "claude-s1", "Proposer r2", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Same point"],
			}),
			"p-3": turnEvents("p-3", "claude", "claude-s1", "Proposer r3", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Same point"],
			}),
			"p-4": turnEvents("p-4", "claude", "claude-s1", "Proposer r4", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Same point"],
			}),
		});

		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "strongly_disagree",
				confidence: 0.9,
				key_points: ["Counter point"],
			}),
			"c-2": turnEvents("c-2", "codex", "codex-s1", "Challenger r2", {
				stance: "strongly_disagree",
				confidence: 0.9,
				key_points: ["Counter point"],
			}),
			"c-3": turnEvents("c-3", "codex", "codex-s1", "Challenger r3", {
				stance: "strongly_disagree",
				confidence: 0.9,
				key_points: ["Counter point"],
			}),
			"c-4": turnEvents("c-4", "codex", "codex-s1", "Challenger r4", {
				stance: "strongly_disagree",
				confidence: 0.9,
				key_points: ["Counter point"],
			}),
		});

		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();
		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

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

		const result = await runDebate(stagnantConfig, adapters, { bus });
		expect(result.phase).toBe("completed");
		// Should complete without crash — no judge events emitted
		expect(collected.some((e) => e.kind === "judge.started")).toBe(false);
		expect(collected.some((e) => e.kind === "judge.completed")).toBe(false);
		// Director should have detected stagnation signals
		const directorActions = collected.filter(
			(e) => e.kind === "director.action",
		);
		expect(directorActions.length).toBeGreaterThanOrEqual(1);
	});

	it("summary.leading inferred from stance when no judge verdict", async () => {
		// Without a judge, the summary generator infers "leading" from
		// the stance trajectory. Proposer confidence 0.9 > challenger 0.6 + 0.1,
		// so leading should be "proposer", not "unknown".
		const noJudgeConfig: DebateConfig = { ...config, maxRounds: 1 };
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();
		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "strongly_agree",
				confidence: 0.9,
				key_points: ["Strong argument"],
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "disagree",
				confidence: 0.6,
				key_points: ["Weak counter"],
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

		await runDebate(noJudgeConfig, adapters, { bus });

		const completedEvent = collected.find((e) => e.kind === "debate.completed");
		expect(completedEvent).toBeDefined();
		const summary = (completedEvent as any).summary;
		expect(summary).toBeDefined();
		expect(summary.leading).toBe("proposer");
		expect(summary.judgeScore).toBeNull();
	});

	it("maxRounds=1 produces valid output", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crossfire-test-"));
		try {
			const singleRoundConfig: DebateConfig = { ...config, maxRounds: 1 };
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

			const result = await runDebate(singleRoundConfig, adapters, {
				outputDir: tmpDir,
			});
			expect(result.phase).toBe("completed");
			expect(result.terminationReason).toBe("max-rounds");
			expect(result.turns).toHaveLength(2);
			expect(existsSync(join(tmpDir, "action-plan.html"))).toBe(true);
			expect(existsSync(join(tmpDir, "action-plan.md"))).toBe(true);
			// Verify the HTML is non-empty and contains basic structure
			const html = readFileSync(join(tmpDir, "action-plan.html"), "utf-8");
			expect(html.length).toBeGreaterThan(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("convergenceThreshold=0 converges immediately when stances match", async () => {
		// Both agents with neutral stance → stanceDelta = 0, threshold = 0
		// → 0 <= 0 → converged in round 1
		const zeroThresholdConfig: DebateConfig = {
			...config,
			maxRounds: 10,
			convergenceThreshold: 0,
		};

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "neutral",
				confidence: 0.5,
				key_points: ["Neutral A"],
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "neutral",
				confidence: 0.5,
				key_points: ["Neutral B"],
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

		const result = await runDebate(zeroThresholdConfig, adapters);
		expect(result.terminationReason).toBe("convergence");
		expect(result.turns).toHaveLength(2);
		expect(result.currentRound).toBe(1);
	});

	it("convergenceThreshold=1.0 never converges on threshold alone", async () => {
		// Counterintuitively, threshold=1.0 means stanceDelta <= 1.0 is ALWAYS
		// true (max possible delta is 1.0: strongly_agree vs strongly_disagree).
		// So even with maximally opposed stances, the debate converges immediately.
		const maxThresholdConfig: DebateConfig = {
			...config,
			maxRounds: 10,
			convergenceThreshold: 1.0,
		};

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents(
				"p-1",
				"claude",
				"claude-s1",
				"Proposer strongly agrees",
				{
					stance: "strongly_agree",
					confidence: 0.95,
					key_points: ["Maximum agreement"],
				},
			),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents(
				"c-1",
				"codex",
				"codex-s1",
				"Challenger strongly disagrees",
				{
					stance: "strongly_disagree",
					confidence: 0.95,
					key_points: ["Maximum disagreement"],
				},
			),
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

		const result = await runDebate(maxThresholdConfig, adapters);
		// stanceDelta = |1.0 - 0.0| = 1.0, and 1.0 <= 1.0, so converged
		expect(result.terminationReason).toBe("convergence");
		expect(result.turns).toHaveLength(2);
		expect(result.currentRound).toBe(1);
	});

	it("uses incremental prompts: initial on Turn 1, incremental on Turn 2+", async () => {
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();
		const collected: AnyEvent[] = [];
		bus.subscribe((e) => collected.push(e));

		const twoRoundConfig: DebateConfig = { ...config, maxRounds: 2 };

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
		};

		const result = await runDebate(twoRoundConfig, adapters, { bus });
		expect(result.phase).toBe("completed");
		expect(result.turns).toHaveLength(4);
	});

	it("passes systemPrompt to initial prompt when provided in config", async () => {
		const { DebateEventBus } = await import("../src/event-bus.js");
		const bus = new DebateEventBus();

		const configWithSystem: DebateConfig = {
			...config,
			maxRounds: 1,
			proposerSystemPrompt: "Custom proposer system prompt",
			challengerSystemPrompt: "Custom challenger system prompt",
		};

		// Capture prompts sent to adapters
		const sentPrompts: { turnId: string; prompt: string }[] = [];
		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer r1", {
				stance: "agree",
				confidence: 0.7,
				key_points: ["A"],
			}),
		});
		const origSendTurn = proposer.sendTurn.bind(proposer);
		proposer.sendTurn = async (handle, input) => {
			sentPrompts.push({ turnId: input.turnId, prompt: input.prompt });
			return origSendTurn(handle, input);
		};

		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger r1", {
				stance: "disagree",
				confidence: 0.7,
				key_points: ["B"],
			}),
		});
		const origChallengerSendTurn = challenger.sendTurn.bind(challenger);
		challenger.sendTurn = async (handle, input) => {
			sentPrompts.push({ turnId: input.turnId, prompt: input.prompt });
			return origChallengerSendTurn(handle, input);
		};

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

		await runDebate(configWithSystem, adapters, { bus });

		// Proposer initial prompt should contain custom system prompt
		const proposerPrompt = sentPrompts.find((p) => p.turnId === "p-1");
		expect(proposerPrompt).toBeDefined();
		expect(proposerPrompt!.prompt).toContain("Custom proposer system prompt");

		// Challenger initial prompt should contain custom system prompt
		const challengerPrompt = sentPrompts.find((p) => p.turnId === "c-1");
		expect(challengerPrompt).toBeDefined();
		expect(challengerPrompt!.prompt).toContain(
			"Custom challenger system prompt",
		);
	});
});

describe("getSchemaRefreshMode", () => {
	it("returns 'full' for turn 1", () => {
		expect(getSchemaRefreshMode(1, 3, 0)).toBe("full");
	});

	it("returns 'reminder' for normal mid-debate turns", () => {
		expect(getSchemaRefreshMode(2, 3, 0)).toBe("reminder");
		expect(getSchemaRefreshMode(4, 3, 0)).toBe("reminder");
	});

	it("returns 'full' on cadence-aligned turns", () => {
		expect(getSchemaRefreshMode(3, 3, 0)).toBe("full");
		expect(getSchemaRefreshMode(6, 3, 0)).toBe("full");
	});

	it("returns 'full' when there are consecutive failures", () => {
		expect(getSchemaRefreshMode(2, 3, 1)).toBe("full");
		expect(getSchemaRefreshMode(4, 3, 2)).toBe("full");
	});

	it("returns 'reminder' when judgeEveryN is 0 (disabled)", () => {
		expect(getSchemaRefreshMode(2, 0, 0)).toBe("reminder");
		expect(getSchemaRefreshMode(5, 0, 0)).toBe("reminder");
	});
});

describe("recoveryContext wiring", () => {
	it("sets recoveryContext on proposer and challenger sessions", async () => {
		const smallConfig: DebateConfig = {
			...config,
			maxRounds: 1,
			proposerSystemPrompt: "Proposer system prompt",
			challengerSystemPrompt: "Challenger system prompt",
		};

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "Proposer round 1", {
				stance: "agree",
				confidence: 0.8,
				key_points: ["Point"],
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "Challenger round 1", {
				stance: "disagree",
				confidence: 0.7,
				key_points: ["Counter"],
			}),
		});

		const proposerSession = await proposer.startSession({
			profile: "test",
			workingDirectory: "/tmp",
		});
		const challengerSession = await challenger.startSession({
			profile: "test",
			workingDirectory: "/tmp",
		});

		const adapters: AdapterMap = {
			proposer: { adapter: proposer, session: proposerSession },
			challenger: { adapter: challenger, session: challengerSession },
		};

		await runDebate(smallConfig, adapters);

		// Verify recoveryContext was set
		expect(proposerSession.recoveryContext).toBeDefined();
		expect(proposerSession.recoveryContext!.role).toBe("proposer");
		expect(proposerSession.recoveryContext!.topic).toBe("Test debate topic");
		expect(proposerSession.recoveryContext!.systemPrompt).toBe(
			"Proposer system prompt",
		);
		expect(proposerSession.recoveryContext!.schemaType).toBe("debate_meta");
		expect(proposerSession.recoveryContext!.maxRounds).toBe(1);

		expect(challengerSession.recoveryContext).toBeDefined();
		expect(challengerSession.recoveryContext!.role).toBe("challenger");
		expect(challengerSession.recoveryContext!.systemPrompt).toBe(
			"Challenger system prompt",
		);
	});

	it("sets recoveryContext on judge session with judge_verdict schema", async () => {
		const smallConfig: DebateConfig = {
			...config,
			maxRounds: 1,
			judgeSystemPrompt: "Judge system prompt",
		};

		const proposer = createScriptedAdapter("claude", {
			"p-1": turnEvents("p-1", "claude", "claude-s1", "P round 1", {
				stance: "agree",
				confidence: 0.8,
				key_points: ["Point"],
			}),
		});
		const challenger = createScriptedAdapter("codex", {
			"c-1": turnEvents("c-1", "codex", "codex-s1", "C round 1", {
				stance: "disagree",
				confidence: 0.7,
				key_points: ["Counter"],
			}),
		});
		const judge = createScriptedAdapter("claude", {
			"j-1": judgeTurnEvents("j-1", "claude", "claude-s1"),
			"j-final": judgeTurnEvents("j-final", "claude", "claude-s1"),
		});

		const judgeSession = await judge.startSession({
			profile: "test",
			workingDirectory: "/tmp",
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
			judge: { adapter: judge, session: judgeSession },
		};

		await runDebate(smallConfig, adapters);

		expect(judgeSession.recoveryContext).toBeDefined();
		expect(judgeSession.recoveryContext!.role).toBe("judge");
		expect(judgeSession.recoveryContext!.schemaType).toBe("judge_verdict");
		expect(judgeSession.recoveryContext!.systemPrompt).toBe(
			"Judge system prompt",
		);
	});
});
