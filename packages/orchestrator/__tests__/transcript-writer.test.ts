import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranscriptWriter } from "../src/transcript-writer.js";

/** Helper: feed a sequence of events into a writer */
function feedEvents(writer: TranscriptWriter, events: AnyEvent[]): void {
	for (const e of events) {
		writer.handleEvent(e);
	}
}

/** Helper: build a minimal debate with configurable rounds */
function makeDebateEvents(
	rounds: Array<{
		roundNumber: number;
		proposerText?: string;
		challengerText?: string;
	}>,
	topic = "Test topic",
): AnyEvent[] {
	const events: AnyEvent[] = [
		{
			kind: "debate.started",
			config: {
				topic,
				maxRounds: 3,
				judgeEveryNRounds: 0,
				convergenceThreshold: 0.3,
			},
			timestamp: 1000,
		} as AnyEvent,
	];
	let ts = 2000;
	for (const round of rounds) {
		if (round.proposerText !== undefined) {
			events.push({
				kind: "round.started",
				roundNumber: round.roundNumber,
				speaker: "proposer",
				timestamp: ts++,
			} as AnyEvent);
			events.push({
				kind: "message.final",
				text: round.proposerText,
				role: "assistant",
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: `p-${round.roundNumber}`,
				timestamp: ts++,
			} as AnyEvent);
		}
		if (round.challengerText !== undefined) {
			events.push({
				kind: "round.started",
				roundNumber: round.roundNumber,
				speaker: "challenger",
				timestamp: ts++,
			} as AnyEvent);
			events.push({
				kind: "message.final",
				text: round.challengerText,
				role: "assistant",
				adapterId: "codex",
				adapterSessionId: "s2",
				turnId: `c-${round.roundNumber}`,
				timestamp: ts++,
			} as AnyEvent);
		}
	}
	events.push({
		kind: "debate.completed",
		reason: "max-rounds",
		timestamp: ts,
	} as AnyEvent);
	return events;
}

describe("TranscriptWriter", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "transcript-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("generates transcript.html from debate events", async () => {
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

		const content = await readFile(join(dir, "transcript.html"), "utf-8");
		expect(content).toContain("<!DOCTYPE html>");
		expect(content).toContain("Is TDD worth it?");
		expect(content).toContain("Proposer");
		expect(content).toContain("TDD catches bugs early");
		expect(content).toContain("Challenger");
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
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: 1500,
		} as AnyEvent);
		writer.handleEvent({
			kind: "message.final",
			text: "Proposer argument",
			role: "assistant",
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "p-1",
			timestamp: 2000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "judge.started",
			roundNumber: 1,
			timestamp: 3000,
		} as AnyEvent);
		writer.handleEvent({
			kind: "message.final",
			text: "Proposer made stronger arguments.",
			role: "assistant",
			adapterId: "claude",
			adapterSessionId: "s3",
			turnId: "j-1",
			timestamp: 4000,
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

		const content = await readFile(join(dir, "transcript.html"), "utf-8");
		expect(content).toContain("<!DOCTYPE html>");
		expect(content).toContain("Judge");
		expect(content).toContain("Proposer made stronger arguments");
		expect(content).toContain("7-5");
	});

	describe("getCleanTranscript()", () => {
		it("returns stripped content per round for both speakers", () => {
			const writer = new TranscriptWriter(dir);
			const metaBlock =
				'```debate_meta\n{"confidence":0.8}\n```\nActual argument here.';
			feedEvents(
				writer,
				makeDebateEvents([
					{
						roundNumber: 1,
						proposerText: metaBlock,
						challengerText: 'Challenge text\njudge_verdict\n{"score":5}\n',
					},
					{
						roundNumber: 2,
						proposerText: "Round 2 proposer",
						challengerText: "Round 2 challenger",
					},
				]),
			);

			const transcript = writer.getCleanTranscript();
			expect(transcript.size).toBe(2);

			const r1 = transcript.get(1);
			expect(r1).toBeDefined();
			expect(r1?.proposer).toBe("Actual argument here.");
			expect(r1?.challenger).toBe("Challenge text");

			const r2 = transcript.get(2);
			expect(r2).toBeDefined();
			expect(r2?.proposer).toBe("Round 2 proposer");
			expect(r2?.challenger).toBe("Round 2 challenger");
		});

		it("returns partial round with only one speaker present", () => {
			const writer = new TranscriptWriter(dir);
			feedEvents(
				writer,
				makeDebateEvents([
					{
						roundNumber: 1,
						proposerText: "Only proposer spoke",
					},
				]),
			);

			const transcript = writer.getCleanTranscript();
			expect(transcript.size).toBe(1);

			const r1 = transcript.get(1);
			expect(r1).toBeDefined();
			expect(r1?.proposer).toBe("Only proposer spoke");
			expect(r1?.challenger).toBeUndefined();
		});

		it("returns empty map when no rounds occurred", () => {
			const writer = new TranscriptWriter(dir);
			writer.handleEvent({
				kind: "debate.started",
				config: {
					topic: "Empty",
					maxRounds: 1,
					judgeEveryNRounds: 0,
					convergenceThreshold: 0.3,
				},
				timestamp: 1000,
			} as AnyEvent);

			const transcript = writer.getCleanTranscript();
			expect(transcript.size).toBe(0);
		});
	});

	describe("transcript.md output", () => {
		it("writes transcript.md beside transcript.html on close()", async () => {
			const writer = new TranscriptWriter(dir);
			feedEvents(
				writer,
				makeDebateEvents(
					[
						{
							roundNumber: 1,
							proposerText: "Pro argument",
							challengerText: "Con argument",
						},
					],
					"MD Test Topic",
				),
			);

			await writer.close();

			const md = await readFile(join(dir, "transcript.md"), "utf-8");
			expect(md).toContain("# Debate Transcript");
			expect(md).toContain("**Topic:** MD Test Topic");
			expect(md).toContain("## Round 1");
			expect(md).toContain("### Proposer");
			expect(md).toContain("Pro argument");
			expect(md).toContain("### Challenger");
			expect(md).toContain("Con argument");
		});

		it("includes judge section in markdown when verdict present", async () => {
			const writer = new TranscriptWriter(dir);
			writer.handleEvent({
				kind: "debate.started",
				config: {
					topic: "Judge MD",
					maxRounds: 1,
					judgeEveryNRounds: 1,
					convergenceThreshold: 0.3,
				},
				timestamp: 1000,
			} as AnyEvent);
			writer.handleEvent({
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1500,
			} as AnyEvent);
			writer.handleEvent({
				kind: "message.final",
				text: "Proposer says",
				role: "assistant",
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
				timestamp: 2000,
			} as AnyEvent);
			writer.handleEvent({
				kind: "judge.started",
				roundNumber: 1,
				timestamp: 3000,
			} as AnyEvent);
			writer.handleEvent({
				kind: "message.final",
				text: "Good debate so far.",
				role: "assistant",
				adapterId: "claude",
				adapterSessionId: "s3",
				turnId: "j-1",
				timestamp: 4000,
			} as AnyEvent);
			writer.handleEvent({
				kind: "judge.completed",
				roundNumber: 1,
				verdict: {
					leading: "proposer",
					score: { proposer: 8, challenger: 4 },
					reasoning: "Strong arguments.",
					shouldContinue: false,
				},
				timestamp: 5000,
			} as AnyEvent);

			await writer.close();

			const md = await readFile(join(dir, "transcript.md"), "utf-8");
			expect(md).toContain("### Judge");
			expect(md).toContain("Good debate so far.");
			expect(md).toContain("**Decision:** End | 8-4");
		});
	});
});
