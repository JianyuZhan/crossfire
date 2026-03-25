import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import type { AnyEvent } from "@crossfire/orchestrator-core";
import type { DebateEventBus } from "./event-bus.js";

/**
 * Run final synthesis in a new isolated adapter session.
 * Creates session, wires events to bus, sends one turn with the synthesis prompt,
 * waits for turn.completed, extracts markdown.
 * Always closes the session in a finally block.
 */
export async function runFinalSynthesis(
	adapter: AgentAdapter,
	bus: DebateEventBus,
	prompt: string,
	timeoutMs: number,
): Promise<string | undefined> {
	let session: SessionHandle | undefined;
	let eventUnsub: (() => void) | undefined;

	try {
		session = await adapter.startSession({
			profile: "",
			workingDirectory: ".",
		});
		const sessionId = session.adapterSessionId;
		const turnId = "synthesis-final";

		// Wire adapter events to bus for this synthesis session
		eventUnsub = adapter.onEvent((e: AnyEvent) => bus.push(e));

		let messageFinal: string | undefined;
		let deltaBuffer = "";
		let resolveCompletion: () => void;

		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});

		const busUnsub = bus.subscribe((event: AnyEvent) => {
			if (
				!("adapterSessionId" in event) ||
				(event as unknown as { adapterSessionId?: string }).adapterSessionId !==
					sessionId
			)
				return;
			if (
				!("turnId" in event) ||
				(event as unknown as { turnId?: string }).turnId !== turnId
			)
				return;

			if (event.kind === "message.delta") {
				deltaBuffer += (event as { text?: string }).text ?? "";
			}
			if (event.kind === "message.final") {
				messageFinal = (event as { text?: string }).text;
			}
			if (event.kind === "turn.completed") {
				resolveCompletion();
			}
		});

		try {
			// sendTurn resolves when streaming BEGINS, not ends
			await adapter.sendTurn(session, {
				turnId,
				prompt,
			});

			// Wait for turn.completed (authoritative signal) or timeout
			await Promise.race([
				completionPromise,
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error("synthesis timeout")), timeoutMs),
				),
			]);

			// Prefer message.final, fall back to accumulated deltas
			return messageFinal || (deltaBuffer.length > 0 ? deltaBuffer : undefined);
		} finally {
			busUnsub();
		}
	} catch {
		return undefined;
	} finally {
		if (eventUnsub) eventUnsub();
		if (session) {
			try {
				await adapter.close(session);
			} catch {
				// cleanup is best-effort
			}
		}
	}
}
