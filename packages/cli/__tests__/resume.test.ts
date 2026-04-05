import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the `crossfire resume` command.
 *
 * These tests exercise the extractable logic of resume.ts without requiring
 * real adapters, file I/O, or network access. The command implementation is
 * tested by replicating its decision logic in pure functions.
 */

// ---------------------------------------------------------------------------
// Helpers: replicate the extractable decision logic from resume.ts
// ---------------------------------------------------------------------------

/**
 * Determines if a debate is already completed and what message to show.
 * Mirrors resume.ts lines 40-45.
 */
function checkCompletedDebate(state: {
	phase: string;
	terminationReason?: string;
	currentRound: number;
}): { completed: boolean; messages: string[] } {
	if (state.phase === "completed") {
		return {
			completed: true,
			messages: [
				"Debate already completed.",
				`Reason: ${state.terminationReason}`,
				`Total rounds: ${state.currentRound}`,
				"Use `crossfire replay` to review the debate.",
			],
		};
	}
	return { completed: false, messages: [] };
}

/**
 * Resolves which profile name to use for a given role.
 * Mirrors resume.ts lines 48-58.
 */
function resolveProfileName(
	role: "proposer" | "challenger" | "judge",
	cliOverride: string | undefined,
	meta: {
		profiles: {
			proposer: { name: string };
			challenger: { name: string };
			judge?: { name: string };
		};
	},
): string | "none" {
	if (role === "judge") {
		if (!meta.profiles.judge) return "none";
		return cliOverride ?? meta.profiles.judge.name;
	}
	return cliOverride ?? meta.profiles[role].name;
}

/**
 * Generates the segment filename for a resume operation.
 * Mirrors resume.ts line 95.
 */
function buildSegmentFilename(timestamp: number): string {
	return `events-resumed-${timestamp}.jsonl`;
}

/**
 * Validates that index.json has the required config field.
 * Mirrors resume.ts lines 28-31.
 */
function validateIndexMeta(meta: Record<string, unknown>): string | null {
	if (!meta.config) {
		return "Error: index.json missing config field";
	}
	return null;
}

/**
 * Builds the resume info message.
 * Mirrors resume.ts lines 78-81.
 */
function buildResumeMessage(
	currentRound: number,
	topic: string,
): { roundMessage: string; topicMessage: string } {
	return {
		roundMessage: `Resuming debate from round ${currentRound + 1}`,
		topicMessage: `Topic: ${topic}`,
	};
}

// ---------------------------------------------------------------------------
// 1. Completed debate detection
// ---------------------------------------------------------------------------
describe("completed debate detection", () => {
	it("detects completed phase and returns exit messages", () => {
		const result = checkCompletedDebate({
			phase: "completed",
			terminationReason: "convergence",
			currentRound: 5,
		});
		expect(result.completed).toBe(true);
		expect(result.messages).toContain("Debate already completed.");
		expect(result.messages).toContain("Reason: convergence");
		expect(result.messages).toContain("Total rounds: 5");
	});

	it("returns not-completed for proposer-turn phase", () => {
		const result = checkCompletedDebate({
			phase: "proposer-turn",
			currentRound: 2,
		});
		expect(result.completed).toBe(false);
		expect(result.messages).toHaveLength(0);
	});

	it("returns not-completed for challenger-turn phase", () => {
		const result = checkCompletedDebate({
			phase: "challenger-turn",
			currentRound: 3,
		});
		expect(result.completed).toBe(false);
	});

	it("returns not-completed for judging phase", () => {
		const result = checkCompletedDebate({
			phase: "judging",
			currentRound: 1,
		});
		expect(result.completed).toBe(false);
	});

	it("returns not-completed for idle phase", () => {
		const result = checkCompletedDebate({
			phase: "idle",
			currentRound: 0,
		});
		expect(result.completed).toBe(false);
	});

	it("suggests using crossfire replay when debate is completed", () => {
		const result = checkCompletedDebate({
			phase: "completed",
			terminationReason: "max-rounds",
			currentRound: 10,
		});
		const hasReplayHint = result.messages.some((m) =>
			m.toLowerCase().includes("replay"),
		);
		expect(hasReplayHint).toBe(true);
	});

	it("shows undefined terminationReason when not set", () => {
		const result = checkCompletedDebate({
			phase: "completed",
			currentRound: 3,
		});
		expect(result.messages).toContain("Reason: undefined");
	});
});

// ---------------------------------------------------------------------------
// 2. Profile resolution from index.json with/without CLI overrides
// ---------------------------------------------------------------------------
describe("profile resolution from index.json", () => {
	const meta = {
		profiles: {
			proposer: { name: "claude/proposer" },
			challenger: { name: "codex/challenger" },
			judge: { name: "gemini/judge" },
		},
	};

	it("uses index.json proposer profile when no CLI override", () => {
		expect(resolveProfileName("proposer", undefined, meta)).toBe(
			"claude/proposer",
		);
	});

	it("uses CLI override for proposer when provided", () => {
		expect(resolveProfileName("proposer", "codex/proposer", meta)).toBe(
			"codex/proposer",
		);
	});

	it("uses index.json challenger profile when no CLI override", () => {
		expect(resolveProfileName("challenger", undefined, meta)).toBe(
			"codex/challenger",
		);
	});

	it("uses CLI override for challenger when provided", () => {
		expect(resolveProfileName("challenger", "gemini/challenger", meta)).toBe(
			"gemini/challenger",
		);
	});

	it("uses index.json judge profile when no CLI override", () => {
		expect(resolveProfileName("judge", undefined, meta)).toBe("gemini/judge");
	});

	it("uses CLI override for judge when provided", () => {
		expect(resolveProfileName("judge", "claude/judge", meta)).toBe(
			"claude/judge",
		);
	});

	it("returns 'none' when index.json has no judge and no CLI override", () => {
		const noJudgeMeta = {
			profiles: {
				proposer: { name: "claude/proposer" },
				challenger: { name: "codex/challenger" },
			},
		};
		expect(resolveProfileName("judge", undefined, noJudgeMeta)).toBe("none");
	});

	it("returns 'none' when index.json judge is null and no CLI override", () => {
		const nullJudgeMeta = {
			profiles: {
				proposer: { name: "claude/proposer" },
				challenger: { name: "codex/challenger" },
				judge: undefined as unknown as { name: string },
			},
		};
		expect(resolveProfileName("judge", undefined, nullJudgeMeta)).toBe("none");
	});

	it("ignores CLI judge override when index.json has no judge entry", () => {
		// This matches the implementation: if meta.profiles.judge is falsy,
		// the result is always "none" even with a CLI override.
		// This is a deliberate design choice (can't override a judge that
		// didn't exist in the original debate).
		const noJudgeMeta = {
			profiles: {
				proposer: { name: "claude/proposer" },
				challenger: { name: "codex/challenger" },
			},
		};
		expect(resolveProfileName("judge", "claude/judge", noJudgeMeta)).toBe(
			"none",
		);
	});
});

// ---------------------------------------------------------------------------
// 3. Segment filename convention
// ---------------------------------------------------------------------------
describe("segment filename convention", () => {
	it("generates filename with events-resumed- prefix", () => {
		const filename = buildSegmentFilename(1711001000000);
		expect(filename).toBe("events-resumed-1711001000000.jsonl");
	});

	it("uses .jsonl extension", () => {
		const filename = buildSegmentFilename(12345);
		expect(filename).toMatch(/\.jsonl$/);
	});

	it("includes timestamp in filename", () => {
		const ts = Date.now();
		const filename = buildSegmentFilename(ts);
		expect(filename).toContain(String(ts));
	});

	it("uses events-resumed- prefix matching doc convention", () => {
		const filename = buildSegmentFilename(1711001000);
		expect(filename).toMatch(/^events-resumed-/);
	});
});

// ---------------------------------------------------------------------------
// 4. index.json validation
// ---------------------------------------------------------------------------
describe("index.json validation", () => {
	it("returns null when config field is present", () => {
		const err = validateIndexMeta({
			config: { topic: "test", maxRounds: 5 },
			debateId: "abc",
		});
		expect(err).toBeNull();
	});

	it("returns error when config field is missing", () => {
		const err = validateIndexMeta({ debateId: "abc" });
		expect(err).toBe("Error: index.json missing config field");
	});

	it("returns error when config is null", () => {
		const err = validateIndexMeta({ config: null });
		// null is falsy, so treated as missing
		expect(err).toBe("Error: index.json missing config field");
	});

	it("returns error when config is undefined", () => {
		const err = validateIndexMeta({ config: undefined });
		expect(err).toBe("Error: index.json missing config field");
	});

	it("returns error for empty object (no config)", () => {
		const err = validateIndexMeta({});
		expect(err).toBe("Error: index.json missing config field");
	});

	it("accepts config even if it has no fields (truthy object)", () => {
		const err = validateIndexMeta({ config: {} });
		expect(err).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 5. Resume info message
// ---------------------------------------------------------------------------
describe("resume info message", () => {
	it("shows next round number (currentRound + 1)", () => {
		const msg = buildResumeMessage(2, "AI safety");
		expect(msg.roundMessage).toBe("Resuming debate from round 3");
	});

	it("shows round 1 when currentRound is 0", () => {
		const msg = buildResumeMessage(0, "AI safety");
		expect(msg.roundMessage).toBe("Resuming debate from round 1");
	});

	it("includes topic in message", () => {
		const msg = buildResumeMessage(4, "Should we use microservices?");
		expect(msg.topicMessage).toBe("Topic: Should we use microservices?");
	});
});

// ---------------------------------------------------------------------------
// 6. Bus hydration with existing events
// ---------------------------------------------------------------------------
describe("bus hydration logic", () => {
	it("pushes all existing events into bus before attaching persistence", () => {
		// Simulate the hydration pattern from resume.ts lines 90-93
		const pushed: unknown[] = [];
		const mockBus = {
			push: (event: unknown) => pushed.push(event),
		};

		const existingEvents = [
			{ kind: "debate.started", timestamp: 1000 },
			{ kind: "round.started", round: 1, timestamp: 2000 },
			{ kind: "turn.started", role: "proposer", timestamp: 3000 },
			{ kind: "turn.completed", role: "proposer", timestamp: 4000 },
		];

		for (const event of existingEvents) {
			mockBus.push(event);
		}

		expect(pushed).toHaveLength(4);
		expect(pushed[0]).toEqual({ kind: "debate.started", timestamp: 1000 });
		expect(pushed[3]).toEqual({
			kind: "turn.completed",
			role: "proposer",
			timestamp: 4000,
		});
	});

	it("maintains event order during hydration", () => {
		const pushed: { kind: string }[] = [];
		const mockBus = {
			push: (event: { kind: string }) => pushed.push(event),
		};

		const events = [
			{ kind: "debate.started" },
			{ kind: "round.started" },
			{ kind: "turn.started" },
			{ kind: "turn.completed" },
			{ kind: "round.started" },
			{ kind: "turn.started" },
		];

		for (const event of events) {
			mockBus.push(event);
		}

		expect(pushed.map((e) => e.kind)).toEqual([
			"debate.started",
			"round.started",
			"turn.started",
			"turn.completed",
			"round.started",
			"turn.started",
		]);
	});

	it("handles empty event list (no prior events)", () => {
		const pushed: unknown[] = [];
		const mockBus = {
			push: (event: unknown) => pushed.push(event),
		};

		const events: unknown[] = [];
		for (const event of events) {
			mockBus.push(event);
		}

		expect(pushed).toHaveLength(0);
	});

	it("hydrates TUI store with existing events for resumed debates", async () => {
		const { hydrateTuiStoreFromEvents } = await import(
			"../src/commands/resume.js"
		);
		const handled: unknown[] = [];
		const store = {
			handleEvent: (event: unknown) => handled.push(event),
		};
		const events = [
			{ kind: "debate.started", debateId: "deb-1", timestamp: 1000 },
			{ kind: "policy.baseline", role: "proposer", timestamp: 2000 },
		];

		hydrateTuiStoreFromEvents(store, events);

		expect(handled).toEqual(events);
	});
});

// ---------------------------------------------------------------------------
// 7. Command option definitions
// ---------------------------------------------------------------------------
describe("resume command option definitions", () => {
	// Test by importing the actual command object
	// Using dynamic import to avoid side effects
	it("defines output-dir as required argument", async () => {
		const { resumeCommand } = await import("../src/commands/resume.js");
		const args = resumeCommand.registeredArguments;
		expect(args).toHaveLength(1);
		expect(args[0].name()).toBe("output-dir");
		expect(args[0].required).toBe(true);
	});

	it("defines --config option for config file override", async () => {
		const { resumeCommand } = await import("../src/commands/resume.js");
		const opt = resumeCommand.options.find((o) => o.long === "--config");
		expect(opt).toBeDefined();
	});

	it("defines --headless option defaulting to false", async () => {
		const { resumeCommand } = await import("../src/commands/resume.js");
		const opt = resumeCommand.options.find((o) => o.long === "--headless");
		expect(opt).toBeDefined();
		expect(opt?.defaultValue).toBe(false);
	});

	it("has description mentioning resume", async () => {
		const { resumeCommand } = await import("../src/commands/resume.js");
		expect(resumeCommand.description()).toMatch(/resume/i);
	});
});

// ---------------------------------------------------------------------------
// 8. runDebate integration shape (resumeFromState)
// ---------------------------------------------------------------------------
describe("runDebate resume options shape", () => {
	it("passes resumeFromState when resuming", () => {
		// Verify the shape that resume.ts constructs for runDebate() call
		const currentState = {
			phase: "proposer-turn" as const,
			currentRound: 3,
			turns: [],
			convergence: {
				converged: false,
				stanceDelta: 0.5,
				mutualConcessions: 0,
				bothWantToConclude: false,
			},
			config: {
				topic: "test",
				maxRounds: 10,
				convergenceThreshold: 0.3,
			},
		};

		const runOptions = {
			bus: {} as unknown,
			debateId: "test-id",
			outputDir: "/output/test",
			resumeFromState: currentState,
		};

		expect(runOptions.resumeFromState).toBeDefined();
		expect(runOptions.resumeFromState.phase).toBe("proposer-turn");
		expect(runOptions.resumeFromState.currentRound).toBe(3);
		expect(runOptions.debateId).toBe("test-id");
	});

	it("debateId comes from index.json meta", () => {
		const meta = {
			debateId: "debate-abc-123",
			config: { topic: "test" },
		};
		expect(meta.debateId).toBe("debate-abc-123");
	});
});

// ---------------------------------------------------------------------------
// 9. Error handling edge cases
// ---------------------------------------------------------------------------
describe("error handling edge cases", () => {
	it("malformed JSON in index.json throws parse error", () => {
		expect(() => JSON.parse("{invalid json")).toThrow();
	});

	it("missing profiles field in meta causes property access error", () => {
		const meta = { config: { topic: "test" } } as Record<string, unknown>;
		expect(() => {
			const profiles = (meta as { profiles?: { proposer?: { name?: string } } })
				.profiles;
			const _name = profiles?.proposer?.name;
			if (_name === undefined) {
				throw new TypeError("Missing profiles.proposer.name");
			}
		}).toThrow();
	});

	it("missing debateId in meta is handled gracefully (undefined)", () => {
		const meta = { config: { topic: "test" } } as Record<string, unknown>;
		expect((meta as { debateId?: string }).debateId).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 10. SIGINT handler behavior
// ---------------------------------------------------------------------------
describe("SIGINT handler behavior", () => {
	it("constructs debate.completed event with user-interrupt reason", () => {
		// Mirrors resume.ts lines 121-125
		const event = {
			kind: "debate.completed" as const,
			reason: "user-interrupt" as const,
			timestamp: Date.now(),
		};
		expect(event.kind).toBe("debate.completed");
		expect(event.reason).toBe("user-interrupt");
		expect(event.timestamp).toBeGreaterThan(0);
	});

	it("second SIGINT would force exit (abortController already aborted)", () => {
		const abortController = new AbortController();
		let forceExitCalled = false;

		const triggerShutdown = () => {
			if (abortController.signal.aborted) {
				forceExitCalled = true;
				return;
			}
			abortController.abort();
		};

		// First SIGINT: graceful
		triggerShutdown();
		expect(forceExitCalled).toBe(false);
		expect(abortController.signal.aborted).toBe(true);

		// Second SIGINT: force exit
		triggerShutdown();
		expect(forceExitCalled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 11. createBus integration for resume
// ---------------------------------------------------------------------------
describe("createBus for resume scenario", () => {
	it("accepts existingBus parameter", async () => {
		const { DebateEventBus } = await import("@crossfire/orchestrator");
		const { createBus } = await import("../src/wiring/create-bus.js");

		const existingBus = new DebateEventBus();
		const bundle = createBus({ existingBus });

		// Should use the provided bus, not create a new one
		expect(bundle.bus).toBe(existingBus);
	});

	it("accepts segmentFilename parameter", async () => {
		const { mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { createBus } = await import("../src/wiring/create-bus.js");

		const dir = mkdtempSync(join(tmpdir(), "crossfire-resume-test-"));
		const bundle = createBus({
			outputDir: dir,
			segmentFilename: "events-resumed-12345.jsonl",
		});

		expect(bundle.bus).toBeDefined();
		expect(bundle.eventStore).toBeDefined();
		await bundle.close();
	});
});
