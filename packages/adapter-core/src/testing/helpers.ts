import type { AdapterCapabilities } from "../capabilities.js";
import type { NormalizedEvent } from "../types.js";

export function collectEvents(adapter: {
	onEvent: (cb: (e: NormalizedEvent) => void) => () => void;
}): { events: NormalizedEvent[]; unsubscribe: () => void } {
	const events: NormalizedEvent[] = [];
	const unsubscribe = adapter.onEvent((e) => events.push(e));
	return { events, unsubscribe };
}

export function waitForEvent(
	events: NormalizedEvent[],
	predicate: (e: NormalizedEvent) => boolean,
	timeoutMs = 5000,
): Promise<NormalizedEvent> {
	const found = events.find(predicate);
	if (found) return Promise.resolve(found);

	return new Promise((resolve, reject) => {
		const interval = setInterval(() => {
			const match = events.find(predicate);
			if (match) {
				clearInterval(interval);
				clearTimeout(timer);
				resolve(match);
			}
		}, 10);
		const timer = setTimeout(() => {
			clearInterval(interval);
			reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
		}, timeoutMs);
	});
}

export function waitForTurnCompleted(
	events: NormalizedEvent[],
	turnId: string,
	timeoutMs = 5000,
): Promise<NormalizedEvent> {
	return waitForEvent(
		events,
		(e) => e.kind === "turn.completed" && e.turnId === turnId,
		timeoutMs,
	);
}

export function assertCapabilitiesConsistent(
	events: NormalizedEvent[],
	capabilities: AdapterCapabilities,
): void {
	if (
		!capabilities.supportsPlan &&
		events.some((e) => e.kind === "plan.updated")
	) {
		throw new Error("Received plan.updated but supportsPlan=false");
	}
	if (
		!capabilities.supportsApproval &&
		events.some((e) => e.kind.startsWith("approval."))
	) {
		throw new Error("Received approval.* but supportsApproval=false");
	}
	if (
		!capabilities.supportsSubagents &&
		events.some((e) => e.kind.startsWith("subagent."))
	) {
		throw new Error("Received subagent.* but supportsSubagents=false");
	}
}

export function assertEventOrder(events: NormalizedEvent[]): void {
	// tool.call must precede tool.result with matching toolUseId
	for (let i = 0; i < events.length; i++) {
		const call = events[i];
		if (call.kind !== "tool.call") continue;
		const resultIdx = events.findIndex(
			(e) => e.kind === "tool.result" && e.toolUseId === call.toolUseId,
		);
		if (resultIdx !== -1 && i >= resultIdx) {
			throw new Error(
				`tool.call for ${call.toolUseId} must precede tool.result`,
			);
		}
	}

	// approval.request must precede approval.resolved with matching requestId
	for (let i = 0; i < events.length; i++) {
		const req = events[i];
		if (req.kind !== "approval.request") continue;
		const resolvedIdx = events.findIndex(
			(e) => e.kind === "approval.resolved" && e.requestId === req.requestId,
		);
		if (resolvedIdx !== -1 && i >= resolvedIdx) {
			throw new Error(
				`approval.request for ${req.requestId} must precede approval.resolved`,
			);
		}
	}

	// turn.completed must be last event for its turnId
	for (let i = 0; i < events.length; i++) {
		const tc = events[i];
		if (tc.kind !== "turn.completed") continue;
		const hasLaterSameTurn = events
			.slice(i + 1)
			.some((e) => e.turnId === tc.turnId);
		if (hasLaterSameTurn) {
			throw new Error(
				`turn.completed for ${tc.turnId} must be last event for that turn`,
			);
		}
	}

	// session.started must appear at most once
	let sessionStartedCount = 0;
	for (const e of events) {
		if (e.kind === "session.started") sessionStartedCount++;
	}
	if (sessionStartedCount > 1) {
		throw new Error(
			`session.started must appear at most once, found ${sessionStartedCount}`,
		);
	}
}
