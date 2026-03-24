import type { AdapterCapabilities } from "../capabilities.js";
import type { NormalizedEvent } from "../types.js";

export function collectEvents(adapter: {
	onEvent: (cb: (e: NormalizedEvent) => void) => () => void;
}): {
	events: NormalizedEvent[];
	unsubscribe: () => void;
} {
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
) {
	return waitForEvent(
		events,
		(e) => e.kind === "turn.completed" && e.turnId === turnId,
		timeoutMs,
	);
}

export function assertCapabilitiesConsistent(
	events: NormalizedEvent[],
	capabilities: AdapterCapabilities,
) {
	if (!capabilities.supportsPlan) {
		const planEvents = events.filter((e) => e.kind === "plan.updated");
		if (planEvents.length > 0)
			throw new Error("Received plan.updated but supportsPlan=false");
	}
	if (!capabilities.supportsApproval) {
		const approvalEvents = events.filter((e) => e.kind.startsWith("approval."));
		if (approvalEvents.length > 0)
			throw new Error("Received approval.* but supportsApproval=false");
	}
	if (!capabilities.supportsSubagents) {
		const subagentEvents = events.filter((e) => e.kind.startsWith("subagent."));
		if (subagentEvents.length > 0)
			throw new Error("Received subagent.* but supportsSubagents=false");
	}
}

export function assertEventOrder(events: NormalizedEvent[]) {
	// tool.call precedes tool.result with matching toolUseId
	const toolCalls = events.filter((e) => e.kind === "tool.call");
	for (const call of toolCalls) {
		if (call.kind !== "tool.call") continue;
		const callIdx = events.indexOf(call);
		const resultIdx = events.findIndex(
			(e) => e.kind === "tool.result" && e.toolUseId === call.toolUseId,
		);
		if (resultIdx !== -1 && callIdx >= resultIdx) {
			throw new Error(
				`tool.call for ${call.toolUseId} must precede tool.result`,
			);
		}
	}

	// approval.request precedes approval.resolved with matching requestId
	const approvalReqs = events.filter((e) => e.kind === "approval.request");
	for (const req of approvalReqs) {
		if (req.kind !== "approval.request") continue;
		const reqIdx = events.indexOf(req);
		const resolvedIdx = events.findIndex(
			(e) => e.kind === "approval.resolved" && e.requestId === req.requestId,
		);
		if (resolvedIdx !== -1 && reqIdx >= resolvedIdx) {
			throw new Error(
				`approval.request for ${req.requestId} must precede approval.resolved`,
			);
		}
	}

	// turn.completed is last terminal event for its turnId
	const turnCompleteds = events.filter((e) => e.kind === "turn.completed");
	for (const tc of turnCompleteds) {
		const tcIdx = events.indexOf(tc);
		const laterSameTurn = events
			.slice(tcIdx + 1)
			.filter((e) => e.turnId === tc.turnId);
		if (laterSameTurn.length > 0) {
			throw new Error(
				`turn.completed for ${tc.turnId} must be last event for that turn`,
			);
		}
	}

	// session.started must appear at most once
	const sessionStartedEvents = events.filter(
		(e) => e.kind === "session.started",
	);
	if (sessionStartedEvents.length > 1) {
		throw new Error(
			`session.started must appear at most once, found ${sessionStartedEvents.length}`,
		);
	}
}
