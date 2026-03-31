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
	recoveredFrom?: "exit-plan-mode";
	diagnostics?: SynthesisDiagnostics;
}

export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 300_000;

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
	let exitPlanModePlan: string | undefined;
	const diagnostics: SynthesisDiagnostics = {
		sessionCreated: false,
		firstEventMs: undefined,
		toolCallCount: 0,
		eventKindCounts: {},
		capturedFinalPreview: undefined,
	};

	function buildResult(
		error?: string,
		recoveredFrom?: "exit-plan-mode",
	): SynthesisRunResult {
		const recoveredMarkdown =
			recoveredFrom === "exit-plan-mode" ? exitPlanModePlan : undefined;
		return {
			markdown:
				recoveredMarkdown ||
				longestFinal ||
				(deltaBuffer.length > 0 ? deltaBuffer : undefined),
			durationMs: Date.now() - startTime,
			rawDeltaLength: deltaBuffer.length,
			...(error ? { error } : {}),
			...(recoveredFrom ? { recoveredFrom } : {}),
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
		let resolveRecovered: () => void;

		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});
		const recoveredPromise = new Promise<void>((resolve) => {
			resolveRecovered = resolve;
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
				if (
					event.toolName === "ExitPlanMode" &&
					isRecord(event.input) &&
					typeof event.input.plan === "string"
				) {
					exitPlanModePlan = event.input.plan;
				}
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
			if (
				event.kind === "approval.request" &&
				isExitPlanModePayload(event.payload)
			) {
				exitPlanModePlan = event.payload.tool_input.plan;
				void adapter
					.approve?.({
						requestId: event.requestId,
						decision: "allow",
					})
					.catch(() => {
						// Best-effort only; recovery still has the submitted plan.
					});
				resolveRecovered();
			}
			if (event.kind === "turn.completed") {
				resolveCompletion();
			}
		});

		await adapter.sendTurn(session, {
			turnId,
			prompt,
			executionMode: "plan",
		});

		// Wait for turn.completed or timeout
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				completionPromise,
				recoveredPromise,
				new Promise<void>((_, reject) => {
					timeoutId = setTimeout(
						() => reject(new Error("synthesis timeout")),
						timeoutMs,
					);
				}),
			]);
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
			if (eventUnsub) {
				eventUnsub();
				eventUnsub = undefined;
			}
		}

		diagnostics.capturedFinalPreview = (
			exitPlanModePlan || longestFinal
		)?.slice(0, 200);

		return buildResult(
			undefined,
			exitPlanModePlan ? "exit-plan-mode" : undefined,
		);
	} catch (err) {
		diagnostics.capturedFinalPreview = (
			exitPlanModePlan || longestFinal
		)?.slice(0, 200);

		if (exitPlanModePlan) {
			return buildResult(undefined, "exit-plan-mode");
		}

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isExitPlanModePayload(
	payload: unknown,
): payload is { tool_name: "ExitPlanMode"; tool_input: { plan: string } } {
	if (!isRecord(payload)) return false;
	if (payload.tool_name !== "ExitPlanMode") return false;
	if (!isRecord(payload.tool_input)) return false;
	return typeof payload.tool_input.plan === "string";
}
