import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
	TurnInput,
} from "@crossfire/adapter-core";

/**
 * Creates a scripted adapter that emits pre-defined events per turnId.
 * Unknown turnIds emit an immediate turn.completed to prevent hangs.
 *
 * @param id - Adapter identifier
 * @param scripts - Map of turnId to scripted NormalizedEvent arrays
 * @param recordedTurns - Optional array to capture all TurnInput calls
 * @param capabilities - Optional capabilities override (defaults to empty object)
 */
export function createScriptedAdapter(
	id: "claude" | "codex" | "gemini",
	scripts: Record<string, NormalizedEvent[]>,
	recordedTurns?: TurnInput[],
	capabilities?: AgentAdapter["capabilities"],
): AgentAdapter {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	return {
		id,
		capabilities: capabilities ?? ({} as AgentAdapter["capabilities"]),
		async startSession() {
			return {
				adapterSessionId: sessionId,
				providerSessionId: `p-${sessionId}`,
				adapterId: id,
				transcript: [],
			};
		},
		async sendTurn(_handle: SessionHandle, input: TurnInput) {
			recordedTurns?.push(input);
			const eventsForTurn = scripts[input.turnId] ?? [
				{
					kind: "turn.completed" as const,
					status: "completed" as const,
					durationMs: 0,
					timestamp: Date.now(),
					adapterId: id,
					adapterSessionId: sessionId,
					turnId: input.turnId,
				},
			];
			setTimeout(() => {
				for (const e of eventsForTurn) {
					for (const l of listeners) l(e);
				}
			}, 0);
			return { turnId: input.turnId, status: "running" as const };
		},
		onEvent(cb: (e: NormalizedEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	};
}

/** Produces a standard sequence of events for an agent turn (tool.call + message.final + turn.completed). */
export function turnEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
	content: string,
	meta: {
		stance: string;
		confidence: number;
		key_points: string[];
		wants_to_conclude?: boolean;
	},
): NormalizedEvent[] {
	return [
		{
			kind: "tool.call",
			toolUseId: `tu-${turnId}`,
			toolName: "debate_meta",
			input: meta,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "message.final",
			text: content,
			role: "assistant",
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

/** Produces a minimal turn.completed event for a judge turn. */
export function judgeTurnEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
): NormalizedEvent[] {
	return [
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 50,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}
