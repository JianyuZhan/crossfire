import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";

const FLUSH_INTERVAL_MS = 100;
const FORCE_FLUSH_KINDS = new Set([
	"turn.completed",
	"debate.completed",
	"synthesis.started",
	"synthesis.completed",
	"synthesis.error",
]);

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

	constructor(outputDir: string, segmentFilename = "events.jsonl") {
		this.dir = outputDir;
		this.segmentFilename = segmentFilename;
		this.eventsPath = join(outputDir, segmentFilename);
		writeFileSync(this.eventsPath, "");
		this.timer = setInterval(() => this.flushSync(), FLUSH_INTERVAL_MS);
	}

	append(event: AnyEvent): void {
		const line = `${JSON.stringify(event)}\n`;

		if (event.kind === "round.started" && "roundNumber" in event) {
			const e = event as { roundNumber: number; speaker?: string };
			const offset = {
				byteOffset: this.byteOffset + this.bufferByteLength(),
				eventIndex: this.totalEvents,
			};
			this.roundOffsets[String(e.roundNumber)] = offset;
			if (e.speaker) {
				const key = `${e.speaker === "proposer" ? "p" : "c"}-${e.roundNumber}`;
				this.turnOffsets[key] = offset;
			}
			if (e.roundNumber > this.totalRounds) {
				this.totalRounds = e.roundNumber;
			}
		}

		if (event.kind === "debate.started" && "config" in event) {
			const e = event as { config: { topic: string } };
			this.topic = e.config.topic;
			this.startedAt = event.timestamp;
			this.debateId = `d-${new Date(event.timestamp).toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
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
		return this.buffer.reduce(
			(len, line) => len + Buffer.byteLength(line, "utf-8"),
			0,
		);
	}

	private writeIndex(): void {
		const lastEvent = this.totalEvents > 0 ? Date.now() : this.startedAt;
		const indexPath = join(this.dir, "index.json");

		// Read existing index.json (written by CLI with profiles/config/versions)
		let existing: Record<string, unknown> = {};
		try {
			existing = JSON.parse(readFileSync(indexPath, "utf-8"));
		} catch {
			/* no existing index */
		}

		let segments: Array<{
			file: string;
			eventCount: number;
			startedAt: number;
		}>;

		if (this.segmentFilename === "events.jsonl") {
			// Initial segment: single segment entry
			segments = [
				{
					file: this.segmentFilename,
					eventCount: this.totalEvents,
					startedAt: this.startedAt ?? Date.now(),
				},
			];
		} else {
			// Resume segment: append to existing segments array
			const existingSegments = existing.segments as
				| Array<{
						file: string;
						eventCount: number;
						startedAt: number;
				  }>
				| undefined;
			segments = existingSegments ?? [
				{
					file: "events.jsonl",
					eventCount: (existing.totalEvents as number) ?? 0,
					startedAt: (existing.startedAt as number) ?? 0,
				},
			];
			segments.push({
				file: this.segmentFilename,
				eventCount: this.totalEvents,
				startedAt: this.startedAt ?? Date.now(),
			});
		}

		// Merge: preserve CLI-written fields (profiles, config, versions) + add runtime data
		const index = {
			...existing,
			debateId: this.debateId ?? existing.debateId ?? "unknown",
			topic: this.topic ?? existing.topic ?? "",
			startedAt: this.startedAt ?? existing.startedAt ?? 0,
			endedAt: lastEvent,
			totalEvents: this.totalEvents,
			totalRounds: this.totalRounds,
			terminationReason: this.terminationReason,
			roundOffsets: this.roundOffsets,
			turnOffsets: this.turnOffsets,
			segments,
		};
		writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
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
		yield* EventStore.load(eventsPath);
	}
}
