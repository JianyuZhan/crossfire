import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";

const FLUSH_INTERVAL_MS = 100;
const FORCE_FLUSH_KINDS = new Set(["turn.completed", "debate.completed"]);

export class EventStore {
	private readonly eventsPath: string;
	private readonly dir: string;
	private readonly segmentFilename: string;
	private buffer: string[] = [];
	private totalEvents = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private byteOffset = 0;
	private roundOffsets: Record<
		string,
		{ byteOffset: number; eventIndex: number }
	> = {};
	private turnOffsets: Record<
		string,
		{ byteOffset: number; eventIndex: number }
	> = {};
	private debateId?: string;
	private topic?: string;
	private startedAt?: number;
	private totalRounds = 0;
	private terminationReason?: string;
	private config?: Record<string, unknown>;

	constructor(outputDir: string, segmentFilename = "events.jsonl") {
		this.dir = outputDir;
		this.segmentFilename = segmentFilename;
		this.eventsPath = join(outputDir, segmentFilename);
		writeFileSync(this.eventsPath, "");
		this.timer = setInterval(() => this.flushSync(), FLUSH_INTERVAL_MS);
	}

	append(event: AnyEvent): void {
		const line = JSON.stringify(event) + "\n";

		if (event.kind === "round.started" && "roundNumber" in event) {
			const rn = (event as { roundNumber: number }).roundNumber;
			this.roundOffsets[String(rn)] = {
				byteOffset: this.byteOffset + this.bufferByteLength(),
				eventIndex: this.totalEvents,
			};
		}

		if (
			event.kind === "round.started" &&
			"speaker" in event &&
			"roundNumber" in event
		) {
			const e = event as { speaker: string; roundNumber: number };
			const key = `${e.speaker === "proposer" ? "p" : "c"}-${e.roundNumber}`;
			this.turnOffsets[key] = {
				byteOffset: this.byteOffset + this.bufferByteLength(),
				eventIndex: this.totalEvents,
			};
		}

		if (event.kind === "debate.started" && "config" in event) {
			const e = event as { config: { topic: string } };
			this.topic = e.config.topic;
			this.config = e.config as unknown as Record<string, unknown>;
			this.startedAt = event.timestamp;
			this.debateId = `d-${new Date(event.timestamp).toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
			this.writeMeta();
		}

		if (event.kind === "round.started" && "roundNumber" in event) {
			const rn = (event as { roundNumber: number }).roundNumber;
			if (rn > this.totalRounds) this.totalRounds = rn;
		}

		if (event.kind === "debate.completed" && "reason" in event) {
			this.terminationReason = (event as { reason: string }).reason;
		}

		this.buffer.push(line);
		this.totalEvents++;

		if (FORCE_FLUSH_KINDS.has(event.kind)) {
			this.flushSync();
		}
	}

	async flush(): Promise<void> {
		this.flushSync();
	}

	async close(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.flushSync();
		this.writeIndex();
	}

	private flushSync(): void {
		if (this.buffer.length === 0) return;
		const chunk = this.buffer.join("");
		appendFileSync(this.eventsPath, chunk);
		this.byteOffset += Buffer.byteLength(chunk, "utf-8");
		this.buffer = [];
	}

	private bufferByteLength(): number {
		let len = 0;
		for (const line of this.buffer) {
			len += Buffer.byteLength(line, "utf-8");
		}
		return len;
	}

	private writeMeta(): void {
		const metaPath = join(this.dir, "meta.json");
		let existing: Record<string, unknown> = {};
		try {
			existing = JSON.parse(readFileSync(metaPath, "utf-8"));
		} catch {
			// No existing meta.json, start fresh
		}
		const meta = {
			...existing,
			config: this.config ?? existing.config ?? {},
			versions: { crossfire: "0.1.0", nodeVersion: process.version },
		};
		writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
	}

	private writeIndex(): void {
		const lastEvent = this.totalEvents > 0 ? Date.now() : this.startedAt;
		const indexPath = join(this.dir, "index.json");

		let segments: Array<{
			file: string;
			eventCount: number;
			startedAt: number;
		}>;

		if (this.segmentFilename === "events.jsonl") {
			// Initial segment: write fresh index with single segment
			segments = [
				{
					file: this.segmentFilename,
					eventCount: this.totalEvents,
					startedAt: this.startedAt ?? Date.now(),
				},
			];
		} else {
			// Resume segment: append to existing segments array
			try {
				const existingIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
				segments = existingIndex.segments ?? [
					{
						file: "events.jsonl",
						eventCount: existingIndex.totalEvents ?? 0,
						startedAt: existingIndex.startedAt ?? 0,
					},
				];
				segments.push({
					file: this.segmentFilename,
					eventCount: this.totalEvents,
					startedAt: this.startedAt ?? Date.now(),
				});
			} catch {
				// If no existing index, create one with just this segment
				segments = [
					{
						file: this.segmentFilename,
						eventCount: this.totalEvents,
						startedAt: this.startedAt ?? Date.now(),
					},
				];
			}
		}

		const index = {
			debateId: this.debateId ?? "unknown",
			topic: this.topic ?? "",
			startedAt: this.startedAt ?? 0,
			endedAt: lastEvent,
			totalEvents: this.totalEvents,
			totalRounds: this.totalRounds,
			terminationReason: this.terminationReason,
			roundOffsets: this.roundOffsets,
			turnOffsets: this.turnOffsets,
			segments,
		};
		writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
	}

	static load(eventsPath: string): AnyEvent[] {
		const content = readFileSync(eventsPath, "utf-8");
		return content
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as AnyEvent);
	}

	static loadSegments(outputDir: string): AnyEvent[] {
		const indexPath = join(outputDir, "index.json");
		const index = JSON.parse(readFileSync(indexPath, "utf-8"));
		const segments: { file: string }[] = index.segments ?? [
			{ file: "events.jsonl" },
		];
		return segments.flatMap((seg) =>
			EventStore.load(join(outputDir, seg.file)),
		);
	}

	static async *stream(eventsPath: string): AsyncIterable<AnyEvent> {
		const events = EventStore.load(eventsPath);
		for (const event of events) {
			yield event;
		}
	}
}
