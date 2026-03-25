import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";

/**
 * Run final synthesis in a new isolated adapter session.
 * Creates session, subscribes directly to adapter events (not via bus to avoid
 * duplication when the caller already wires adapter→bus), sends one turn with
 * the synthesis prompt, waits for turn.completed, extracts markdown.
 * Always closes the session in a finally block.
 */
export async function runFinalSynthesis(
	adapter: AgentAdapter,
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

		let longestFinal: string | undefined;
		let deltaBuffer = "";
		let resolveCompletion: () => void;

		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});

		// Subscribe directly to adapter events (not via bus) to avoid
		// duplication when runner.ts already wires adapter→bus.
		eventUnsub = adapter.onEvent((event: NormalizedEvent) => {
			if (event.adapterSessionId !== sessionId) return;
			if (event.turnId !== turnId) return;

			if (event.kind === "message.delta") {
				deltaBuffer += event.text;
			}
			if (event.kind === "message.final") {
				// Keep the longest message.final — LLM may emit multiple
				// (e.g., thinking, tool use, then final answer)
				if (!longestFinal || event.text.length > longestFinal.length) {
					longestFinal = event.text;
				}
			}
			if (event.kind === "turn.completed") {
				resolveCompletion();
			}
		});

		await adapter.sendTurn(session, { turnId, prompt });

		// Wait for turn.completed or timeout
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				completionPromise,
				new Promise<void>((_, reject) => {
					timeoutId = setTimeout(
						() => reject(new Error("synthesis timeout")),
						timeoutMs,
					);
				}),
			]);
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}

		return longestFinal || (deltaBuffer.length > 0 ? deltaBuffer : undefined);
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
