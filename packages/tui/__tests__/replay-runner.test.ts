import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReplayEventSource } from "../src/replay/event-source.js";
import { ScaledClock } from "../src/replay/playback-clock.js";

function makeEvents(): AnyEvent[] {
	const base = 1000;
	return [
		{
			kind: "debate.started",
			config: {
				topic: "T",
				maxRounds: 2,
				judgeEveryNRounds: 0,
				convergenceThreshold: 0.3,
			},
			timestamp: base,
		},
		{
			kind: "round.started",
			roundNumber: 1,
			speaker: "proposer",
			timestamp: base + 100,
		},
		{
			kind: "message.final",
			text: "Hello",
			role: "assistant",
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "p-1",
			timestamp: base + 500,
		},
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 400,
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "p-1",
			timestamp: base + 600,
		},
		{ kind: "debate.completed", reason: "max-rounds", timestamp: base + 700 },
	] as AnyEvent[];
}

describe("ReplayEventSource", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "replay-"));
		const jsonl =
			makeEvents()
				.map((e) => JSON.stringify(e))
				.join("\n") + "\n";
		await writeFile(join(dir, "events.jsonl"), jsonl);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("delivers all events in order", async () => {
		const clock = new ScaledClock(1000);
		const source = new ReplayEventSource(join(dir, "events.jsonl"), clock);
		const received: AnyEvent[] = [];
		source.subscribe((e) => received.push(e));
		await source.start();
		expect(received).toHaveLength(5);
		expect(received[0].kind).toBe("debate.started");
		expect(received[4].kind).toBe("debate.completed");
	});

	it("delivers events with timing when speed is moderate", async () => {
		const clock = new ScaledClock(50);
		const source = new ReplayEventSource(join(dir, "events.jsonl"), clock);
		const timestamps: number[] = [];
		source.subscribe(() => timestamps.push(Date.now()));
		const startTime = Date.now();
		await source.start();
		const totalMs = Date.now() - startTime;
		expect(totalMs).toBeLessThan(500);
		expect(timestamps).toHaveLength(5);
	});

	it("can be stopped mid-replay", async () => {
		const clock = new ScaledClock(1);
		const source = new ReplayEventSource(join(dir, "events.jsonl"), clock);
		const received: AnyEvent[] = [];
		source.subscribe((e) => received.push(e));
		const promise = source.start();
		await new Promise((r) => setTimeout(r, 50));
		source.stop();
		await promise;
		expect(received.length).toBeGreaterThanOrEqual(1);
		expect(received.length).toBeLessThan(5);
	});
});
