import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";

export interface SynthesisDiagnostics {
	sessionCreated: boolean;
	firstEventMs: number | undefined;
	toolCallCount: number;
	eventKindCounts: Record<string, number>;
	capturedFinalPreview: string | undefined;
}

export interface SynthesisRunResult {
	markdown: string | undefined;
	durationMs: number;
	rawDeltaLength: number;
	error?: string;
	diagnostics?: SynthesisDiagnostics;
}

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
): Promise<SynthesisRunResult> {
	const startTime = Date.now();
	let session: SessionHandle | undefined;
	let eventUnsub: (() => void) | undefined;

	// Hoisted so catch/finally blocks can access intermediate data
	let longestFinal: string | undefined;
	let deltaBuffer = "";
	const diagnostics: SynthesisDiagnostics = {
		sessionCreated: false,
		firstEventMs: undefined,
		toolCallCount: 0,
		eventKindCounts: {},
		capturedFinalPreview: undefined,
	};

	function buildResult(error?: string): SynthesisRunResult {
		return {
			markdown:
				longestFinal || (deltaBuffer.length > 0 ? deltaBuffer : undefined),
			durationMs: Date.now() - startTime,
			rawDeltaLength: deltaBuffer.length,
			...(error ? { error } : {}),
			diagnostics,
		};
	}

	try {
		session = await adapter.startSession({
			profile: "",
			workingDirectory: ".",
		});
		diagnostics.sessionCreated = true;
		const sessionId = session.adapterSessionId;
		const turnId = "synthesis-final";

		let resolveCompletion: () => void;

		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});

		// Subscribe directly to adapter events (not via bus) to avoid
		// duplication when runner.ts already wires adapter→bus.
		eventUnsub = adapter.onEvent((event: NormalizedEvent) => {
			if (event.adapterSessionId !== sessionId) return;
			if (event.turnId !== turnId) return;

			// Track diagnostics
			if (diagnostics.firstEventMs === undefined) {
				diagnostics.firstEventMs = Date.now() - startTime;
			}
			diagnostics.eventKindCounts[event.kind] =
				(diagnostics.eventKindCounts[event.kind] ?? 0) + 1;

			if (event.kind === "tool.call") {
				diagnostics.toolCallCount++;
			}
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

		diagnostics.capturedFinalPreview = longestFinal?.slice(0, 200);

		return buildResult();
	} catch (err) {
		diagnostics.capturedFinalPreview = longestFinal?.slice(0, 200);

		return buildResult(err instanceof Error ? err.message : String(err));
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
