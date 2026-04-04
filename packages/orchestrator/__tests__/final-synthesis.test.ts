import { describe, expect, it, vi } from "vitest";

describe("runFinalSynthesis", () => {
	const adapterSessionId = "synth-session-1";

	/** Create a mock adapter that emits canned events via onEvent callback */
	function createMockAdapter(eventsToEmit?: Array<Record<string, unknown>>) {
		let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
		return {
			id: "mock",
			startSession: vi.fn().mockResolvedValue({
				adapterSessionId,
				providerSessionId: undefined,
				adapterId: "mock",
			}),
			sendTurn: vi.fn().mockImplementation(async () => {
				if (eventsToEmit && onEventCb) {
					const cb = onEventCb;
					queueMicrotask(() => {
						for (const e of eventsToEmit) cb(e);
					});
				}
			}),
			close: vi.fn().mockResolvedValue(undefined),
			onEvent: vi
				.fn()
				.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
					onEventCb = cb;
					return () => {
						onEventCb = undefined;
					};
				}),
		};
	}

	it("returns markdown from message.final when synthesis succeeds", async () => {
		const mockAdapter = createMockAdapter([
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: "## Executive Summary\n\nFull report.",
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 500,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result.markdown).toContain("Executive Summary");
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("sends synthesis turns in plan mode to discourage tool use", async () => {
		const mockAdapter = createMockAdapter([
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 50,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		await runFinalSynthesis(mockAdapter as any, "test prompt", 10_000);

		expect(mockAdapter.sendTurn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				turnId: "synthesis-final",
				prompt: "test prompt",
			}),
		);
	});

	it("returns undefined on timeout and still closes session", async () => {
		const mockAdapter = createMockAdapter(); // no events → timeout

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			100,
		);
		expect(result.markdown).toBeUndefined();
		expect(mockAdapter.close).toHaveBeenCalled();
	});

	it("falls back to delta buffer when message.final is missing", async () => {
		const mockAdapter = createMockAdapter([
			{
				kind: "message.delta",
				turnId: "synthesis-final",
				text: "## Report from deltas",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 300,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result.markdown).toContain("Report from deltas");
	});

	it("keeps the longest message.final when multiple are emitted", async () => {
		const shortText = "Short summary of the report.";
		const longText =
			"## Executive Summary\n\nThis is a comprehensive, detailed report that covers all sections including consensus items, unresolved disagreements, risk matrix, and evidence registry. It represents the full synthesis output.";
		const mockAdapter = createMockAdapter([
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: shortText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: longText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "message.final",
				turnId: "synthesis-final",
				text: shortText,
				role: "assistant",
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
			{
				kind: "turn.completed",
				turnId: "synthesis-final",
				status: "completed",
				durationMs: 1000,
				timestamp: Date.now(),
				adapterId: "mock",
				adapterSessionId,
			},
		]);

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			10_000,
		);
		expect(result.markdown).toBe(longText);
	});

	it("auto-approves ExitPlanMode during synthesis and returns the submitted plan", async () => {
		let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
		const mockAdapter = {
			id: "claude",
			startSession: vi.fn().mockResolvedValue({
				adapterSessionId: "synth-session-1",
				providerSessionId: undefined,
				adapterId: "claude",
			}),
			sendTurn: vi.fn().mockImplementation(async () => {
				if (onEventCb) {
					const cb = onEventCb;
					queueMicrotask(() => {
						cb({
							kind: "approval.request",
							turnId: "synthesis-final",
							requestId: "ar-synthesis-final-exit",
							approvalType: "tool",
							title: "Approve tool: ExitPlanMode",
							payload: {
								tool_name: "ExitPlanMode",
								tool_input: {
									plan: "## Executive Summary\n\nRecovered plan",
								},
							},
							timestamp: Date.now(),
							adapterId: "claude",
							adapterSessionId: "synth-session-1",
						});
					});
				}
			}),
			approve: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			onEvent: vi
				.fn()
				.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
					onEventCb = cb;
					return () => {
						onEventCb = undefined;
					};
				}),
		};

		const { runFinalSynthesis } = await import("../src/final-synthesis.js");
		const result = await runFinalSynthesis(
			mockAdapter as any,
			"test prompt",
			5000,
		);

		expect(mockAdapter.approve).toHaveBeenCalledWith({
			requestId: "ar-synthesis-final-exit",
			decision: "allow",
		});
		expect(result.markdown).toBe("## Executive Summary\n\nRecovered plan");
		expect(result.error).toBeUndefined();
		expect(result.recoveredFrom).toBe("exit-plan-mode");
	});

	describe("runFinalSynthesis structured result", () => {
		it("returns structured result with markdown and durationMs on success", async () => {
			const mockAdapter = createMockAdapter([
				{
					kind: "message.final",
					turnId: "synthesis-final",
					adapterSessionId: adapterSessionId,
					text: "# Final Report",
					timestamp: Date.now(),
				},
				{
					kind: "turn.completed",
					turnId: "synthesis-final",
					adapterSessionId: adapterSessionId,
					timestamp: Date.now(),
				},
			]);

			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(
				mockAdapter as any,
				"prompt",
				5000,
			);
			expect(result.markdown).toBe("# Final Report");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.error).toBeUndefined();
			expect(result.rawDeltaLength).toBeGreaterThanOrEqual(0);
		});

		it("returns error info on timeout without throwing", async () => {
			const mockAdapter = createMockAdapter([]); // never completes
			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(mockAdapter as any, "prompt", 50);
			expect(result.markdown).toBeUndefined();
			expect(result.error).toBe("synthesis timeout");
			expect(result.durationMs).toBeGreaterThanOrEqual(50);
		});

		it("preserves captured deltas and finals on timeout", async () => {
			let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
			const mockAdapter = {
				id: "mock",
				startSession: vi.fn().mockResolvedValue({
					adapterSessionId: "synth-session-1",
					providerSessionId: undefined,
					adapterId: "mock",
				}),
				sendTurn: vi.fn().mockImplementation(async () => {
					if (onEventCb) {
						const cb = onEventCb;
						queueMicrotask(() => {
							cb({
								kind: "message.delta",
								turnId: "synthesis-final",
								text: "I'll start by exploring...",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
							cb({
								kind: "message.final",
								turnId: "synthesis-final",
								text: "I'll start by exploring the codebase",
								role: "assistant",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
							// No turn.completed → will timeout
						});
					}
				}),
				close: vi.fn().mockResolvedValue(undefined),
				onEvent: vi
					.fn()
					.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
						onEventCb = cb;
						return () => {
							onEventCb = undefined;
						};
					}),
			};

			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(
				mockAdapter as any,
				"test prompt",
				100,
			);

			expect(result.error).toBe("synthesis timeout");
			// Key assertion: intermediate data is NOT discarded
			expect(result.rawDeltaLength).toBeGreaterThan(0);
			expect(result.markdown).toContain("exploring");
		});

		it("recovers from ExitPlanMode when the provider never emits turn.completed", async () => {
			let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
			const mockAdapter = {
				id: "claude",
				startSession: vi.fn().mockResolvedValue({
					adapterSessionId: "synth-session-1",
					providerSessionId: undefined,
					adapterId: "claude",
				}),
				sendTurn: vi.fn().mockImplementation(async () => {
					if (onEventCb) {
						const cb = onEventCb;
						queueMicrotask(() => {
							cb({
								kind: "message.final",
								turnId: "synthesis-final",
								text: "Plan ready for review.",
								role: "assistant",
								timestamp: Date.now(),
								adapterId: "claude",
								adapterSessionId: "synth-session-1",
							});
							cb({
								kind: "approval.request",
								turnId: "synthesis-final",
								requestId: "ar-synthesis-final-exit",
								approvalType: "tool",
								title: "Approve tool: ExitPlanMode",
								payload: {
									tool_name: "ExitPlanMode",
									tool_input: {
										plan: "## Executive Summary\n\nRecovered after timeout",
									},
								},
								timestamp: Date.now(),
								adapterId: "claude",
								adapterSessionId: "synth-session-1",
							});
							// No turn.completed -> provider bug; should still recover.
						});
					}
				}),
				approve: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				onEvent: vi
					.fn()
					.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
						onEventCb = cb;
						return () => {
							onEventCb = undefined;
						};
					}),
			};

			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(
				mockAdapter as any,
				"test prompt",
				100,
			);

			expect(result.error).toBeUndefined();
			expect(result.markdown).toBe(
				"## Executive Summary\n\nRecovered after timeout",
			);
			expect(result.recoveredFrom).toBe("exit-plan-mode");
		});

		it("includes diagnostics in result", async () => {
			let onEventCb: ((e: Record<string, unknown>) => void) | undefined;
			const mockAdapter = {
				id: "mock",
				startSession: vi.fn().mockResolvedValue({
					adapterSessionId: "synth-session-1",
					providerSessionId: undefined,
					adapterId: "mock",
				}),
				sendTurn: vi.fn().mockImplementation(async () => {
					if (onEventCb) {
						const cb = onEventCb;
						queueMicrotask(() => {
							cb({
								kind: "message.delta",
								turnId: "synthesis-final",
								text: "Hello",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
							cb({
								kind: "tool.call",
								turnId: "synthesis-final",
								toolName: "Glob",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
							cb({
								kind: "message.final",
								turnId: "synthesis-final",
								text: "Hello world",
								role: "assistant",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
							cb({
								kind: "turn.completed",
								turnId: "synthesis-final",
								status: "completed",
								timestamp: Date.now(),
								adapterId: "mock",
								adapterSessionId: "synth-session-1",
							});
						});
					}
				}),
				close: vi.fn().mockResolvedValue(undefined),
				onEvent: vi
					.fn()
					.mockImplementation((cb: (e: Record<string, unknown>) => void) => {
						onEventCb = cb;
						return () => {
							onEventCb = undefined;
						};
					}),
			};

			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(
				mockAdapter as any,
				"test prompt",
				10_000,
			);

			expect(result.diagnostics).toBeDefined();
			expect(result.diagnostics!.sessionCreated).toBe(true);
			expect(result.diagnostics!.toolCallCount).toBe(1);
			expect(result.diagnostics!.eventKindCounts["message.delta"]).toBe(1);
			expect(result.diagnostics!.eventKindCounts["message.final"]).toBe(1);
		});

		it("returns error info on adapter failure", async () => {
			const mockAdapter = createMockAdapter([]);
			mockAdapter.startSession = vi
				.fn()
				.mockRejectedValue(new Error("connection refused"));
			const { runFinalSynthesis } = await import("../src/final-synthesis.js");
			const result = await runFinalSynthesis(
				mockAdapter as any,
				"prompt",
				5000,
			);
			expect(result.markdown).toBeUndefined();
			expect(result.error).toBe("connection refused");
		});
	});
});
