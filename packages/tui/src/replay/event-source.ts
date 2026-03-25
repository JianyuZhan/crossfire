import { readFileSync } from "node:fs";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import { parseJsonlEvents } from "./parse-events.js";
import type { PlaybackClock } from "./playback-clock.js";

export interface EventSource {
	subscribe(cb: (event: AnyEvent) => void): () => void;
	start(): Promise<void>;
	stop(): void;
}

export class LiveEventSource implements EventSource {
	private readonly listeners: Set<(event: AnyEvent) => void> = new Set();
	private unsub?: () => void;

	constructor(
		private readonly bus: {
			subscribe(cb: (event: AnyEvent) => void): () => void;
		},
	) {}

	subscribe(cb: (event: AnyEvent) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	async start(): Promise<void> {
		this.unsub = this.bus.subscribe((event) => {
			for (const cb of this.listeners) cb(event);
		});
	}

	stop(): void {
		this.unsub?.();
	}
}

export class ReplayEventSource implements EventSource {
	private readonly listeners: Set<(event: AnyEvent) => void> = new Set();
	private stopped = false;
	private readonly startFromIndex: number;
	private readonly events: AnyEvent[];

	constructor(
		eventsPathOrEvents: string | AnyEvent[],
		private readonly clock: PlaybackClock,
		options?: { startFromIndex?: number },
	) {
		this.startFromIndex = options?.startFromIndex ?? 0;
		if (typeof eventsPathOrEvents === "string") {
			const content = readFileSync(eventsPathOrEvents, "utf-8");
			this.events = parseJsonlEvents(content);
		} else {
			this.events = eventsPathOrEvents;
		}
	}

	subscribe(cb: (event: AnyEvent) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	async start(): Promise<void> {
		let prevTimestamp: number | undefined;

		for (let i = this.startFromIndex; i < this.events.length; i++) {
			const event = this.events[i];
			if (this.stopped) break;
			if (prevTimestamp !== undefined) {
				const delta = event.timestamp - prevTimestamp;
				if (delta > 0) await this.clock.delay(delta);
			}
			if (this.stopped) break;
			for (const cb of this.listeners) cb(event);
			prevTimestamp = event.timestamp;
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.clock.paused) this.clock.resume();
	}
}
