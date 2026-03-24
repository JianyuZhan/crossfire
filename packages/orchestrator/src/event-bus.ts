import type { NormalizedEvent } from "@crossfire/adapter-core";
import {
	type AnyEvent,
	type OrchestratorEvent,
	projectState,
} from "@crossfire/orchestrator-core";
import type { DebateState } from "@crossfire/orchestrator-core";

export class DebateEventBus {
	private readonly allEvents: AnyEvent[] = [];
	private readonly listeners: Set<(event: AnyEvent) => void> = new Set();

	push(event: AnyEvent): void {
		this.allEvents.push(event);
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	subscribe(cb: (event: AnyEvent) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	snapshot(): DebateState {
		return projectState(this.allEvents);
	}

	getEvents(): ReadonlyArray<AnyEvent> {
		return this.allEvents;
	}
}
