import type { DebateEventBus } from "@crossfire/orchestrator";
import { LiveEventSource, TuiStore } from "@crossfire/tui";

export interface TuiBundle {
	store: TuiStore;
	source: LiveEventSource;
}

export function createTui(
	bus: DebateEventBus,
	headless: boolean,
): TuiBundle | null {
	if (headless) return null;

	const store = new TuiStore();
	const source = new LiveEventSource(bus);
	bus.subscribe((event) => {
		store.handleEvent(event);
	});

	return { store, source };
}
