import {
	type AdapterCapabilities,
	type AgentAdapter,
	GEMINI_CAPABILITIES,
	type NormalizedEvent,
	type SessionHandle,
	type StartSessionInput,
	type TurnHandle,
	type TurnInput,
	parseTurnId,
} from "@crossfire/adapter-core";
import { type GeminiMapContext, mapGeminiEvent } from "./event-mapper.js";
import { type ProcessHandle, ProcessManager } from "./process-manager.js";
import { type HistoryEntry, buildStatelessPrompt } from "./prompt-builder.js";
import { ResumeManager } from "./resume-manager.js";

// ---------------------------------------------------------------------------
// Options & internal types
// ---------------------------------------------------------------------------

export interface GeminiAdapterOptions {
	processManager?: ProcessManager;
	resumeManager?: ResumeManager;
}

/** Per-turn mutable state that enforces single-completion and fallback guards */
interface TurnRuntimeState {
	completed: boolean;
	fallbackTriggered: boolean;
	intentionalKill: boolean;
	resultSeen: boolean;
}

/** Adapter-internal session bookkeeping */
interface GeminiSessionContext {
	providerSessionId: string | undefined;
	model: string | undefined;
	sessionStarted: boolean; // global flag: has session.started been emitted?
	currentProcess: ProcessHandle | null;
	history: HistoryEntry[];
	currentTurnRole?: "proposer" | "challenger" | "judge";
	currentTurnRoundNumber?: number;
}

let sessionCounter = 0;

// ---------------------------------------------------------------------------
// GeminiAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter for the Gemini CLI. Spawns a subprocess per turn, reads JSONL from
 * stdout, and maps events through the event-mapper.
 *
 * Implements A->B fallback: if a resume attempt fails (session mismatch or
 * process crash), the adapter kills the first process and re-spawns with a
 * stateless prompt reconstruction.
 *
 * Gemini does NOT support approval or interrupt via protocol.
 */
export class GeminiAdapter implements AgentAdapter {
	readonly id = "gemini";
	readonly capabilities: AdapterCapabilities = GEMINI_CAPABILITIES;

	// No approve or interrupt methods — capabilities say false.

	private readonly processManager: ProcessManager;
	private readonly resumeManager: ResumeManager;
	private readonly sessions: Map<string, GeminiSessionContext> = new Map();
	private readonly listeners: Set<(e: NormalizedEvent) => void> = new Set();

	constructor(options: GeminiAdapterOptions = {}) {
		this.processManager = options.processManager ?? new ProcessManager();
		this.resumeManager = options.resumeManager ?? new ResumeManager();
	}

	// -- AgentAdapter interface -----------------------------------------------

	async startSession(input: StartSessionInput): Promise<SessionHandle> {
		sessionCounter++;
		const adapterSessionId = `gemini-session-${sessionCounter}-${Date.now()}`;
		const ctx: GeminiSessionContext = {
			providerSessionId: undefined,
			model: input.model,
			sessionStarted: false,
			currentProcess: null,
			history: [],
		};
		this.sessions.set(adapterSessionId, ctx);

		return {
			adapterSessionId,
			providerSessionId: undefined,
			adapterId: "gemini",
			transcript: [],
		};
	}

	async sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle> {
		const turnHandle: TurnHandle = {
			turnId: input.turnId,
			status: "running",
		};

		const session = this.sessions.get(handle.adapterSessionId);
		if (!session) {
			throw new Error(`Unknown session: ${handle.adapterSessionId}`);
		}

		// Store role/roundNumber for transcript tracking
		const parsed = parseTurnId(input.turnId);
		session.currentTurnRole = input.role ?? parsed.role;
		session.currentTurnRoundNumber = input.roundNumber ?? parsed.roundNumber;

		const turnState: TurnRuntimeState = {
			completed: false,
			fallbackTriggered: false,
			intentionalKill: false,
			resultSeen: false,
		};

		// Run the turn attempt in the background (non-blocking)
		this.attemptTurn(session, handle, input, turnState).catch(() => {
			// Errors handled inside attemptTurn via event emission
		});

		return turnHandle;
	}

	onEvent(cb: (e: NormalizedEvent) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	async close(handle: SessionHandle): Promise<void> {
		const session = this.sessions.get(handle.adapterSessionId);
		if (session?.currentProcess) {
			session.currentProcess.kill();
			session.currentProcess = null;
		}
		this.sessions.delete(handle.adapterSessionId);
	}

	// -- Internal: turn execution with A->B fallback --------------------------

	private async attemptTurn(
		session: GeminiSessionContext,
		handle: SessionHandle,
		input: TurnInput,
		turnState: TurnRuntimeState,
	): Promise<void> {
		const turnStart = Date.now();

		// Build map context for this turn. sessionStarted carries over from session
		// so the mapper won't re-emit session.started if it was already sent.
		const mapCtx: GeminiMapContext = {
			adapterId: "gemini",
			adapterSessionId: handle.adapterSessionId,
			turnId: input.turnId,
			sessionStarted: session.sessionStarted,
			messageBuffer: "",
		};

		// Determine if this is a resume attempt (A path)
		const isResumeAttempt = session.providerSessionId !== undefined;

		// Build args via ResumeManager
		const args = this.resumeManager.buildArgs({
			prompt: input.prompt,
			sessionId: session.providerSessionId,
			model: session.model,
		});

		const result = await this.runProcess(
			session,
			handle,
			input,
			turnState,
			mapCtx,
			args,
			turnStart,
			isResumeAttempt,
		);

		// Check if fallback is needed
		if (
			result === "needs-fallback" &&
			isResumeAttempt &&
			!turnState.completed
		) {
			// Emit warning about fallback
			this.emit({
				timestamp: Date.now(),
				adapterId: "gemini",
				adapterSessionId: handle.adapterSessionId,
				turnId: input.turnId,
				kind: "run.warning",
				message:
					"Resume attempt failed, falling back to stateless prompt reconstruction",
			});

			// Reset messageBuffer for B path, but keep sessionStarted flag
			mapCtx.messageBuffer = "";

			// Build stateless prompt
			const statelessPrompt = buildStatelessPrompt(
				input.prompt,
				session.history,
			);

			// Build args with forceStateless
			const fallbackArgs = this.resumeManager.buildArgs({
				prompt: statelessPrompt,
				sessionId: session.providerSessionId,
				model: session.model,
				forceStateless: true,
			});

			turnState.fallbackTriggered = true;
			turnState.intentionalKill = false;
			turnState.resultSeen = false;

			await this.runProcess(
				session,
				handle,
				input,
				turnState,
				mapCtx,
				fallbackArgs,
				turnStart,
				false, // B path is never a resume attempt
			);
		}
	}

	/**
	 * Spawns a process, reads JSONL, emits events.
	 * Returns "needs-fallback" if the process exited without a result event
	 * and the turn isn't completed yet.
	 * Returns "done" if the turn completed normally.
	 */
	private runProcess(
		session: GeminiSessionContext,
		handle: SessionHandle,
		input: TurnInput,
		turnState: TurnRuntimeState,
		mapCtx: GeminiMapContext,
		args: string[],
		turnStart: number,
		isResumeAttempt: boolean,
	): Promise<"done" | "needs-fallback"> {
		return new Promise((resolve) => {
			const proc = this.processManager.spawn(args);
			session.currentProcess = proc;

			let initReceived = false;

			proc.onLine((line: string) => {
				if (turnState.intentionalKill) return;

				let event: { type: string; [key: string]: unknown };
				try {
					event = JSON.parse(line);
				} catch {
					// Skip non-JSON lines
					return;
				}

				// Validate init event if this is a resume attempt
				if (event.type === "init") {
					initReceived = true;

					const validation = this.resumeManager.validateInit(
						event,
						session.providerSessionId,
					);

					if (!validation.valid) {
						// Session mismatch — trigger fallback
						turnState.intentionalKill = true;
						proc.kill();
						resolve("needs-fallback");
						return;
					}

					// Capture providerSessionId from first successful init
					if (!session.providerSessionId && event.session_id) {
						session.providerSessionId = event.session_id as string;
						handle.providerSessionId = event.session_id as string;
					}
				}

				// Handle result event
				if (event.type === "result") {
					turnState.resultSeen = true;
				}

				// Map and emit
				const normalized = mapGeminiEvent(event, mapCtx);
				for (const ne of normalized) {
					// Intercept turn.completed to enforce single-completion guard
					if (ne.kind === "turn.completed") {
						if (turnState.completed) continue; // Skip duplicate
						turnState.completed = true;
						// Override durationMs with actual wall-clock time
						(ne as any).durationMs = Date.now() - turnStart;
					}

					// Track sessionStarted on the session context
					if (ne.kind === "session.started") {
						session.sessionStarted = true;
					}

					// Append to transcript when a turn's final message arrives
					if (ne.kind === "message.final") {
						if (
							session.currentTurnRole &&
							session.currentTurnRoundNumber !== undefined
						) {
							handle.transcript.push({
								roundNumber: session.currentTurnRoundNumber,
								role: session.currentTurnRole,
								content: ne.text,
							});
						}
					}

					this.emit(ne);
				}
			});

			proc.onExit((code: number | null) => {
				session.currentProcess = null;

				// If this process was killed intentionally (for fallback), ignore exit
				if (turnState.intentionalKill) {
					return;
				}

				// If result was already seen, the mapper emitted turn.completed — done
				if (turnState.resultSeen) {
					resolve("done");
					return;
				}

				// Process exited without result
				if (code !== 0 || !initReceived) {
					// Non-zero exit or no init: potential fallback candidate
					if (!turnState.completed) {
						// Check if fallback is possible (only if this was a resume attempt)
						if (isResumeAttempt && !turnState.fallbackTriggered) {
							resolve("needs-fallback");
							return;
						}

						// No fallback possible — emit failure
						this.emit({
							timestamp: Date.now(),
							adapterId: "gemini",
							adapterSessionId: handle.adapterSessionId,
							turnId: input.turnId,
							kind: "run.error",
							message: `Process exited with code ${code}`,
							recoverable: false,
						});

						if (!turnState.completed) {
							turnState.completed = true;
							this.emit({
								timestamp: Date.now(),
								adapterId: "gemini",
								adapterSessionId: handle.adapterSessionId,
								turnId: input.turnId,
								kind: "turn.completed",
								status: "failed",
								durationMs: Date.now() - turnStart,
							});
						}

						resolve("done");
						return;
					}
				}

				// Clean exit (code 0) with init but no result event — unusual but not an error
				resolve("done");
			});
		});
	}

	// -- Helpers --------------------------------------------------------------

	private emit(event: NormalizedEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
