import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranscriptWriter } from "../src/transcript-writer.js";

describe("TranscriptWriter", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "transcript-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("generates transcript.md from debate events", async () => {
		const writer = new TranscriptWriter(dir);

		writer.handleEvent({
			kind: "debate.started",
			config: {
				topic: "Is TDD worth it?",
				maxRounds: 3,
				judgeEveryNRounds: 0,
				convergenceThreshold: 0.3,
			},
			timestamp: 1000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: 2000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "message.final",
			text: "TDD catches bugs early and improves design.",
			role: "assistant",
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "p-1",
			timestamp: 3000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "round.started",
			roundNumber: 1,
			speaker: "challenger",
			timestamp: 4000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "message.final",
			text: "TDD slows down initial development significantly.",
			role: "assistant",
			adapterId: "codex",
			adapterSessionId: "s2",
			turnId: "c-1",
			timestamp: 5000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "debate.completed",
			reason: "max-rounds",
			timestamp: 6000,
		} as AnyEvent);

		await writer.close();

		const content = await readFile(join(dir, "transcript.md"), "utf-8");
		expect(content).toContain("# Debate: Is TDD worth it?");
		expect(content).toContain("## Round 1");
		expect(content).toContain("### Proposer");
		expect(content).toContain("TDD catches bugs early");
		expect(content).toContain("### Challenger");
		expect(content).toContain("TDD slows down initial development");
	});

	it("includes judge verdict when present", async () => {
		const writer = new TranscriptWriter(dir);

		writer.handleEvent({
			kind: "debate.started",
			config: {
				topic: "Test",
				maxRounds: 1,
				judgeEveryNRounds: 1,
				convergenceThreshold: 0.3,
			},
			timestamp: 1000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "judge.completed",
			roundNumber: 1,
			verdict: {
				leading: "proposer",
				score: { proposer: 7, challenger: 5 },
				reasoning: "Proposer made stronger arguments.",
				shouldContinue: false,
			},
			timestamp: 5000,
		} as AnyEvent);

		await writer.close();

		const content = await readFile(join(dir, "transcript.md"), "utf-8");
		expect(content).toContain("Judge");
		expect(content).toContain("Proposer made stronger arguments");
	});
});
