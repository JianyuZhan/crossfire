import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { TuiStore } from "../state/tui-store.js";
import { ReplayEventSource } from "./event-source.js";
import { ScaledClock } from "./playback-clock.js";

export interface ReplayOptions {
	eventsPath: string;
	speed?: number;
	startFromRound?: number;
}

export async function replayDebate(options: ReplayOptions): Promise<TuiStore> {
	const { eventsPath, speed = 1, startFromRound } = options;
	const clock = new ScaledClock(speed);
	const store = new TuiStore();
	let replayStartIndex = 0;

	if (startFromRound !== undefined) {
		const indexPath = join(dirname(eventsPath), "index.json");
		try {
			const index = JSON.parse(readFileSync(indexPath, "utf-8"));
			const offset = index.roundOffsets?.[String(startFromRound)];
			if (offset) replayStartIndex = offset.eventIndex;
		} catch {
			// No index — replay from start
		}

		if (replayStartIndex > 0) {
			const content = readFileSync(eventsPath, "utf-8");
			const allEvents: AnyEvent[] = content
				.trim()
				.split("\n")
				.filter((l) => l.length > 0)
				.map((l) => JSON.parse(l) as AnyEvent);
			for (let i = 0; i < replayStartIndex && i < allEvents.length; i++) {
				store.handleEvent(allEvents[i]);
			}
		}
	}

	const source = new ReplayEventSource(eventsPath, clock, {
		startFromIndex: replayStartIndex,
	});
	source.subscribe((event) => store.handleEvent(event));
	await source.start();
	return store;
}
