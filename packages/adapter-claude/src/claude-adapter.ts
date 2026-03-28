import type {
	AdapterCapabilities,
	AgentAdapter,
	ApprovalDecision,
	LocalTurnMetrics,
	NormalizedEvent,
	SessionHandle,
	StartSessionInput,
	TurnHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import {
	CLAUDE_CAPABILITIES,
	measureLocalMetrics,
	parseTurnId,
} from "@crossfire/adapter-core";
import { buildTranscriptRecoveryPrompt } from "@crossfire/orchestrator-core";
import { mapSdkMessage } from "./event-mapper.js";
import { buildHooks } from "./hooks.js";
import type { QueryFn, QueryResult, SdkMessage } from "./types.js";

/** Options for constructing a ClaudeAdapter */
export interface ClaudeAdapterOptions {
	queryFn: QueryFn;
}

/** Internal state for a running query within a session */
interface QueryContext {
	query: QueryResult;
	currentTurnId: string;
	pendingLocalMetrics?: LocalTurnMetrics;
}

/** Pending approval request state */
interface PendingApproval {
	requestId: string;
	adapterSessionId: string;
	turnId: string;
	resolve: (value: unknown) => void;
}

let sessionCounter = 0;

/**
 * ClaudeAdapter implements the AgentAdapter interface for the Claude Agent SDK.
 *
 * Uses dependency injection (queryFn) to allow mock SDK responses in tests.
 * Hooks translate SDK-level tool/subagent events into NormalizedEvents.
 * The event-mapper handles stream messages (system/init, stream_event, etc.).
 */
export class ClaudeAdapter implements AgentAdapter {
	readonly id = "claude";
	readonly capabilities: AdapterCapabilities = CLAUDE_CAPABILITIES;

	private readonly queryFn: QueryFn;
	private readonly listeners: Set<(e: NormalizedEvent) => void> = new Set();
	private readonly queries: Map<string, QueryContext> = new Map();
	private readonly pendingApprovals: Map<string, PendingApproval> = new Map();
	private readonly sessionModels: Map<string, string> = new Map();

	constructor(options: ClaudeAdapterOptions) {
		this.queryFn = options.queryFn;
	}

	async startSession(input: StartSessionInput): Promise<SessionHandle> {
		sessionCounter++;
		const adapterSessionId = `claude-session-${sessionCounter}-${Date.now()}`;
		if (input.model) {
			this.sessionModels.set(adapterSessionId, input.model);
		}
		return {
			adapterSessionId,
			providerSessionId: undefined,
			adapterId: "claude",
			transcript: [],
		};
	}

	async sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle> {
		const ctx = {
			adapterId: "claude" as const,
			adapterSessionId: handle.adapterSessionId,
			turnId: input.turnId,
		};

		const localMetrics = measureLocalMetrics(input.prompt);

		const hooks = buildHooks(
			(e) => this.emit(e),
			{ adapterId: "claude", adapterSessionId: handle.adapterSessionId },
			() => input.turnId,
		);

		// SDK calls canUseTool to request tool-use permission; we bridge it to
		// the approval event flow and return a promise that blocks the SDK until
		// approve() resolves it.
		const canUseTool = (
			toolName: string,
			toolInput: Record<string, unknown>,
			options: { toolUseID: string; [key: string]: unknown },
		): Promise<unknown> => {
			const toolUseId = options.toolUseID ?? String(Date.now());
			const requestId = `ar-${input.turnId}-${toolUseId}`;

			this.emit({
				...ctx,
				timestamp: Date.now(),
				kind: "approval.request",
				requestId,
				approvalType: "tool",
				title: `Approve tool: ${toolName}`,
				payload: { tool_name: toolName, tool_input: toolInput },
			});

			return new Promise((resolve) => {
				this.pendingApprovals.set(requestId, {
					requestId,
					adapterSessionId: handle.adapterSessionId,
					turnId: input.turnId,
					resolve: (decision) => {
						const { decision: verdict, updatedInput } = decision as {
							decision: string;
							updatedInput?: Record<string, unknown>;
						};
						if (verdict === "allow") {
							resolve({
								behavior: "allow",
								updatedInput: updatedInput ?? toolInput,
							});
						} else {
							resolve({
								behavior: "deny",
								message: "User denied tool use",
							});
						}
					},
				});
			});
		};

		const query = this.queryFn({
			prompt: input.prompt,
			resume: handle.providerSessionId ?? undefined,
			model: this.sessionModels.get(handle.adapterSessionId),
			canUseTool,
			hooks,
		});

		this.queries.set(handle.adapterSessionId, {
			query,
			currentTurnId: input.turnId,
			pendingLocalMetrics: localMetrics,
		});

		// Process the async generator in the background
		this.processMessages(query.messages, ctx, handle, input).catch(() => {
			// Errors are handled inside processMessages via run.error emission
		});

		return { turnId: input.turnId, status: "running" };
	}

	onEvent(cb: (e: NormalizedEvent) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	async approve(req: ApprovalDecision): Promise<void> {
		const pending = this.pendingApprovals.get(req.requestId);
		if (pending) {
			this.pendingApprovals.delete(req.requestId);

			this.emit({
				timestamp: Date.now(),
				adapterId: "claude",
				adapterSessionId: pending.adapterSessionId,
				turnId: pending.turnId,
				kind: "approval.resolved",
				requestId: req.requestId,
				decision: req.decision,
			});

			// Resolve the canUseTool promise to unblock the generator
			pending.resolve({
				decision: req.decision,
				updatedInput: req.updatedInput,
			});
		}
	}

	async interrupt(turnId: string): Promise<void> {
		for (const [, qCtx] of this.queries) {
			if (qCtx.currentTurnId === turnId) {
				qCtx.query.interrupt();
				return;
			}
		}
	}

	async close(handle: SessionHandle): Promise<void> {
		this.queries.delete(handle.adapterSessionId);
		this.sessionModels.delete(handle.adapterSessionId);
		// Clean up any pending approvals for this session
		for (const [id, pending] of this.pendingApprovals) {
			if (pending.adapterSessionId === handle.adapterSessionId) {
				this.pendingApprovals.delete(id);
			}
		}
	}

	private emit(event: NormalizedEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	/**
	 * Consume an SDK message stream — maps each message to NormalizedEvents,
	 * enriches them (session tracking, local metrics, transcript), and emits.
	 */
	private async consumeStream(
		messages: AsyncGenerator<SdkMessage, void, unknown>,
		ctx: { adapterId: "claude"; adapterSessionId: string; turnId: string },
		handle: SessionHandle,
		turnInput: TurnInput,
	): Promise<void> {
		for await (const msg of messages) {
			const events = mapSdkMessage(msg, ctx);
			for (const event of events) {
				if (event.kind === "session.started") {
					handle.providerSessionId = event.providerSessionId;
				}
				if (event.kind === "usage.updated") {
					const queryCtx = this.queries.get(ctx.adapterSessionId);
					if (queryCtx?.pendingLocalMetrics) {
						event.localMetrics = queryCtx.pendingLocalMetrics;
					}
				}
				if (event.kind === "message.final") {
					const role = turnInput.role ?? parseTurnId(turnInput.turnId).role;
					const roundNumber =
						turnInput.roundNumber ?? parseTurnId(turnInput.turnId).roundNumber;
					if (role && roundNumber !== undefined) {
						handle.transcript.push({
							roundNumber,
							role,
							content: event.text,
						});
					}
				}
				this.emit(event);
			}
		}
	}

	private async processMessages(
		messages: AsyncGenerator<SdkMessage, void, unknown>,
		ctx: { adapterId: "claude"; adapterSessionId: string; turnId: string },
		handle: SessionHandle,
		turnInput: TurnInput,
	): Promise<void> {
		try {
			await this.consumeStream(messages, ctx, handle, turnInput);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			// Attempt recovery if recoveryContext is available and we had a provider session
			if (handle.recoveryContext && handle.providerSessionId) {
				this.emit({
					...ctx,
					timestamp: Date.now(),
					kind: "run.warning",
					message: `Resume failed (${message}), attempting transcript recovery`,
				});

				handle.providerSessionId = undefined;

				const hooks = buildHooks(
					(e) => this.emit(e),
					{
						adapterId: "claude",
						adapterSessionId: handle.adapterSessionId,
					},
					() => turnInput.turnId,
				);

				const recoveryQuery = this.queryFn({
					prompt: buildTranscriptRecoveryPrompt({
						systemPrompt: handle.recoveryContext.systemPrompt,
						topic: handle.recoveryContext.topic,
						transcript: handle.transcript,
						schemaType: handle.recoveryContext.schemaType,
					}),
					resume: undefined,
					model: this.sessionModels.get(handle.adapterSessionId),
					hooks,
				});

				this.queries.set(handle.adapterSessionId, {
					query: recoveryQuery,
					currentTurnId: turnInput.turnId,
				});

				// Recovery does NOT recurse — errors here are terminal
				try {
					await this.consumeStream(
						recoveryQuery.messages,
						ctx,
						handle,
						turnInput,
					);
				} catch (recoveryErr) {
					const recoveryMessage =
						recoveryErr instanceof Error
							? recoveryErr.message
							: String(recoveryErr);
					this.emit({
						...ctx,
						timestamp: Date.now(),
						kind: "run.error",
						message: recoveryMessage,
						recoverable: false,
					});
				}
				return;
			}

			this.emit({
				...ctx,
				timestamp: Date.now(),
				kind: "run.error",
				message,
				recoverable: true,
			});
		}
	}
}
