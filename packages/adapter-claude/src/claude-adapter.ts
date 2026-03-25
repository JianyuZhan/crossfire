import type {
	AgentAdapter,
	ApprovalDecision,
	NormalizedEvent,
	SessionHandle,
	StartSessionInput,
	TurnHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import type { AdapterCapabilities } from "@crossfire/adapter-core";
import { CLAUDE_CAPABILITIES } from "@crossfire/adapter-core";
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
		const handle: SessionHandle = {
			adapterSessionId,
			providerSessionId: undefined,
			adapterId: "claude",
		};
		return handle;
	}

	async sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle> {
		const turnHandle: TurnHandle = {
			turnId: input.turnId,
			status: "running",
		};

		const ctx = {
			adapterId: "claude" as const,
			adapterSessionId: handle.adapterSessionId,
			turnId: input.turnId,
		};

		// Build hooks for this turn
		const hooks = buildHooks(
			(e) => this.emit(e),
			{ adapterId: "claude", adapterSessionId: handle.adapterSessionId },
			() => input.turnId,
		);

		// Build the canUseTool callback for approval flow
		const canUseTool = (tool: unknown): Promise<unknown> => {
			// SDK may pass a plain string (tool name) or an object with tool details
			const toolName =
				typeof tool === "string"
					? tool
					: (() => {
							const info = tool as Record<string, unknown>;
							return (
								(info.tool_name as string) ??
								(info.name as string) ??
								(info.toolName as string) ??
								"unknown"
							);
						})();
			const toolUseId =
				typeof tool === "string"
					? String(Date.now())
					: (((tool as Record<string, unknown>).tool_use_id as string) ??
						((tool as Record<string, unknown>).id as string) ??
						String(Date.now()));
			const requestId = `ar-${input.turnId}-${toolUseId}`;

			// Emit approval.request
			this.emit({
				timestamp: Date.now(),
				adapterId: "claude",
				adapterSessionId: handle.adapterSessionId,
				turnId: input.turnId,
				kind: "approval.request",
				requestId,
				approvalType: "tool",
				title: `Approve tool: ${toolName}`,
				payload: typeof tool === "string" ? { tool_name: tool } : tool,
			});

			// Return a promise that will be resolved when approve() is called
			return new Promise((resolve) => {
				this.pendingApprovals.set(requestId, {
					requestId,
					adapterSessionId: handle.adapterSessionId,
					turnId: input.turnId,
					resolve,
				});
			});
		};

		// Start the query
		const query = this.queryFn({
			prompt: input.prompt,
			resume: handle.providerSessionId ?? undefined,
			model: this.sessionModels.get(handle.adapterSessionId),
			canUseTool,
			hooks,
		});

		// Store query context for interrupt
		this.queries.set(handle.adapterSessionId, {
			query,
			currentTurnId: input.turnId,
		});

		// Process the async generator in the background
		this.processMessages(query.messages, ctx, handle).catch(() => {
			// Errors are handled inside processMessages via run.error emission
		});

		return turnHandle;
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

	private async processMessages(
		messages: AsyncGenerator<SdkMessage, void, unknown>,
		ctx: { adapterId: "claude"; adapterSessionId: string; turnId: string },
		handle: SessionHandle,
	): Promise<void> {
		try {
			for await (const msg of messages) {
				const events = mapSdkMessage(msg, ctx);
				for (const event of events) {
					// When we get a session.started event, update the handle's providerSessionId
					if (event.kind === "session.started") {
						handle.providerSessionId = event.providerSessionId;
					}
					this.emit(event);
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.emit({
				timestamp: Date.now(),
				adapterId: ctx.adapterId,
				adapterSessionId: ctx.adapterSessionId,
				turnId: ctx.turnId,
				kind: "run.error",
				message,
				recoverable: true,
			});
		}
	}
}
