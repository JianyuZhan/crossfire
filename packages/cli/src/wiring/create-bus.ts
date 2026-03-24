import {
	DebateEventBus,
	EventStore,
	TranscriptWriter,
} from "@crossfire/orchestrator";

export interface BusBundle {
	bus: DebateEventBus;
	eventStore?: EventStore;
	close(): Promise<void>;
}

export function createBus(options: {
	outputDir?: string;
	segmentFilename?: string;
}): BusBundle {
	const bus = new DebateEventBus();
	let eventStore: EventStore | undefined;
	let transcriptWriter: TranscriptWriter | undefined;

	if (options.outputDir) {
		eventStore = new EventStore(options.outputDir, options.segmentFilename);
		transcriptWriter = new TranscriptWriter(options.outputDir);
		bus.subscribe((event) => {
			eventStore!.append(event);
			transcriptWriter!.handleEvent(event);
		});
	}

	return {
		bus,
		eventStore,
		async close() {
			if (eventStore) await eventStore.close();
			if (transcriptWriter) await transcriptWriter.close();
		},
	};
}
