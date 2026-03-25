import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TuiStore } from "../state/tui-store.js";
import { ReplayEventSource } from "./event-source.js";
import { parseJsonlEvents } from "./parse-events.js";
import { ScaledClock } from "./playback-clock.js";

export interface ReplayOptions {
	outputDir: string;
	speed?: number;
	startFromRound?: number;
}

/**
 * Load all JSONL content from an output directory by reading index.json
 * segments manifest. Falls back to a single events.jsonl if no index exists.
 */
function loadAllEventsContent(outputDir: string): string {
	try {
		const indexPath = join(outputDir, "index.json");
		const index = JSON.parse(readFileSync(indexPath, "utf-8"));
		const segments: { file: string }[] = index.segments ?? [
			{ file: "events.jsonl" },
		];
		return segments
			.map((seg) => readFileSync(join(outputDir, seg.file), "utf-8"))
			.join("");
	} catch {
		// No index.json — fall back to single events.jsonl
		return readFileSync(join(outputDir, "events.jsonl"), "utf-8");
	}
}

export async function replayDebate(options: ReplayOptions): Promise<TuiStore> {
	const { outputDir, speed = 1, startFromRound } = options;
	const clock = new ScaledClock(speed);
	const store = new TuiStore();
	let replayStartIndex = 0;

	const content = loadAllEventsContent(outputDir);
	const allEvents = parseJsonlEvents(content);

	if (startFromRound !== undefined) {
		try {
			const indexPath = join(outputDir, "index.json");
			const index = JSON.parse(readFileSync(indexPath, "utf-8"));
			const offset = index.roundOffsets?.[String(startFromRound)];
			if (offset) replayStartIndex = offset.eventIndex;
		} catch {
			// No index — replay from start
		}

		for (let i = 0; i < replayStartIndex && i < allEvents.length; i++) {
			store.handleEvent(allEvents[i]);
		}
	}

	const source = new ReplayEventSource(allEvents, clock, {
		startFromIndex: replayStartIndex,
	});
	source.subscribe((event) => store.handleEvent(event));
	await source.start();
	return store;
}
