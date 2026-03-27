import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

function makeEvent(
	kind: string,
	extra: Record<string, unknown> = {},
): AnyEvent {
	return { kind, timestamp: Date.now(), ...extra } as AnyEvent;
}

describe("EventStore", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "eventstore-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("round-trips events through append and load", async () => {
		const store = new EventStore(dir);
		const e1 = makeEvent("debate.started", { config: { topic: "test" } });
		const e2 = makeEvent("round.started", {
			roundNumber: 1,
			speaker: "proposer",
		});
		store.append(e1);
		store.append(e2);
		await store.close();

		const loaded = EventStore.load(join(dir, "events.jsonl"));
		expect(loaded).toHaveLength(2);
		expect(loaded[0].kind).toBe("debate.started");
		expect(loaded[1].kind).toBe("round.started");
	});

	it("writes events in JSONL format (one JSON object per line)", async () => {
		const store = new EventStore(dir);
		store.append(makeEvent("debate.started", { config: { topic: "t" } }));
		store.append(makeEvent("debate.completed", { reason: "max-rounds" }));
		await store.close();

		const content = await readFile(join(dir, "events.jsonl"), "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(() => JSON.parse(lines[0])).not.toThrow();
		expect(() => JSON.parse(lines[1])).not.toThrow();
	});

	it("force-flushes on turn.completed events", async () => {
		const store = new EventStore(dir);
		store.append(
			makeEvent("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.append(
			makeEvent("turn.completed", {
				status: "completed",
				durationMs: 100,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			}),
		);
		await new Promise((r) => setTimeout(r, 50));

		const content = await readFile(join(dir, "events.jsonl"), "utf-8");
		const lines = content.trim().split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(2);
		await store.close();
	});

	it("force-flushes on synthesis.error events", async () => {
		const store = new EventStore(dir);
		store.append(
			makeEvent("synthesis.error", {
				phase: "llm-synthesis",
				message: "timeout",
			}),
		);
		// Small delay to allow async flush (though force-flush should be synchronous)
		await new Promise((r) => setTimeout(r, 50));

		// Read file directly - should contain the event (not just buffered)
		const content = await readFile(join(dir, "events.jsonl"), "utf-8");
		expect(content).toContain("synthesis.error");
		await store.close();
	});

	it("writes topic from debate.started into index.json", async () => {
		const store = new EventStore(dir);
		store.append(
			makeEvent("debate.started", {
				config: {
					topic: "Meta test",
					maxRounds: 5,
					judgeEveryNRounds: 1,
					convergenceThreshold: 0.3,
				},
			}),
		);
		await store.close();

		const index = JSON.parse(await readFile(join(dir, "index.json"), "utf-8"));
		expect(index.topic).toBe("Meta test");
	});

	it("generates index.json on close with round offsets and metadata", async () => {
		const store = new EventStore(dir);
		store.append(makeEvent("debate.started", { config: { topic: "idx" } }));
		store.append(
			makeEvent("round.started", { roundNumber: 1, speaker: "proposer" }),
		);
		store.append(
			makeEvent("round.started", { roundNumber: 2, speaker: "proposer" }),
		);
		store.append(makeEvent("debate.completed", { reason: "max-rounds" }));
		await store.close();

		const index = JSON.parse(await readFile(join(dir, "index.json"), "utf-8"));
		expect(index.totalEvents).toBe(4);
		expect(index.totalRounds).toBe(2);
		expect(index.terminationReason).toBe("max-rounds");
		expect(index.roundOffsets).toBeDefined();
		expect(index.roundOffsets["1"]).toBeDefined();
		expect(index.roundOffsets["2"]).toBeDefined();
	});

	it("supports custom segment filenames for resume", async () => {
		const customFilename = "events-resumed-123.jsonl";
		const store = new EventStore(dir, customFilename);
		store.append(makeEvent("debate.started", { config: { topic: "resumed" } }));
		store.append(
			makeEvent("round.started", { roundNumber: 3, speaker: "proposer" }),
		);
		await store.close();

		const customPath = join(dir, customFilename);
		const content = await readFile(customPath, "utf-8");
		expect(content.trim().split("\n")).toHaveLength(2);

		// Verify that no default events.jsonl was created
		const fs = await import("node:fs/promises");
		await expect(fs.access(join(dir, "events.jsonl"))).rejects.toThrow();
	});

	it("loadSegments reads all events from multiple segment files", async () => {
		// Manually create two segment files
		const { writeFile } = await import("node:fs/promises");
		const segment1Path = join(dir, "events.jsonl");
		const segment2Path = join(dir, "events-resumed-456.jsonl");

		const e1 = makeEvent("debate.started", { config: { topic: "seg1" } });
		const e2 = makeEvent("round.started", {
			roundNumber: 1,
			speaker: "proposer",
		});
		const e3 = makeEvent("round.started", {
			roundNumber: 2,
			speaker: "proposer",
		});
		const e4 = makeEvent("debate.completed", { reason: "converged" });

		await writeFile(
			segment1Path,
			`${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`,
		);
		await writeFile(
			segment2Path,
			`${JSON.stringify(e3)}\n${JSON.stringify(e4)}\n`,
		);

		// Create index with segments array
		const index = {
			debateId: "test-id",
			topic: "seg1",
			startedAt: Date.now(),
			endedAt: Date.now(),
			totalEvents: 4,
			totalRounds: 2,
			segments: [
				{ file: "events.jsonl", eventCount: 2, startedAt: Date.now() },
				{
					file: "events-resumed-456.jsonl",
					eventCount: 2,
					startedAt: Date.now(),
				},
			],
		};
		await writeFile(join(dir, "index.json"), JSON.stringify(index, null, 2));

		const allEvents = EventStore.loadSegments(dir);
		expect(allEvents).toHaveLength(4);
		expect(allEvents[0].kind).toBe("debate.started");
		expect(allEvents[1].kind).toBe("round.started");
		expect(allEvents[2].kind).toBe("round.started");
		expect(allEvents[3].kind).toBe("debate.completed");
	});
});
