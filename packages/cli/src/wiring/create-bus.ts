import {
	DebateEventBus,
	EventStore,
	TranscriptWriter,
} from "@crossfire/orchestrator";

export interface BusBundle {
	bus: DebateEventBus;
	eventStore?: EventStore;
	transcriptWriter?: TranscriptWriter;
	close(): Promise<void>;
}

export function createBus(options: {
	outputDir?: string;
	segmentFilename?: string;
	existingBus?: DebateEventBus;
}): BusBundle {
	const bus = options.existingBus ?? new DebateEventBus();
	let eventStore: EventStore | undefined;
	let transcriptWriter: TranscriptWriter | undefined;

	if (options.outputDir) {
		const store = new EventStore(options.outputDir, options.segmentFilename);
		const writer = new TranscriptWriter(options.outputDir);
		eventStore = store;
		transcriptWriter = writer;
		bus.subscribe((event) => {
			store.append(event);
			writer.handleEvent(event);
		});
	}

	return {
		bus,
		eventStore,
		transcriptWriter,
		async close() {
			if (eventStore) await eventStore.close();
			if (transcriptWriter) await transcriptWriter.close();
		},
	};
}
