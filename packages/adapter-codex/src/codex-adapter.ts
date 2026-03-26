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
import { CODEX_CAPABILITIES } from "@crossfire/adapter-core";
import { mapCodexNotification } from "./event-mapper.js";
import type { MapContext } from "./event-mapper.js";
import { JsonRpcClient } from "./jsonrpc-client.js";

/** Approval method types sent by the Codex server */
const APPROVAL_METHODS: Record<
	string,
	"command" | "file-change" | "user-input"
> = {
	"item/commandExecution/requestApproval": "command",
	"item/fileChange/requestApproval": "file-change",
	"tool/requestUserInput": "user-input",
};

/** Options for constructing a CodexAdapter */
export interface CodexAdapterOptions {
	/** Injected client for testing — skips subprocess spawn */
	client?: JsonRpcClient;
	/** Factory to spawn the Codex app-server subprocess (production use) */
	spawnFn?: () => {
		stdin: NodeJS.WritableStream;
		stdout: NodeJS.ReadableStream;
	};
}

/** Internal per-session state */
interface SessionState {
	handle: SessionHandle;
	profile: string;
	model: string;
	currentTurnId?: string;
	currentNativeTurnId?: string;
	turnStartTime?: number;
	turnCount: number;
}

/** Pending approval request */
interface PendingApproval {
	requestId: string;
	adapterSessionId: string;
	turnId: string;
	resolveServerRequest: (result: unknown) => void;
}

/** Instructions appended to prompts so Codex knows how to invoke meta-tools */
const META_TOOL_INSTRUCTIONS = `

## Meta-Tool Usage

When instructed to call \`debate_meta\` or \`judge_verdict\`, run the corresponding shell command with a single-quoted JSON argument. Examples:

\`\`\`
debate_meta '{"stance":"agree","confidence":0.8,"key_points":["point 1","point 2"],"concessions":[]}'
\`\`\`

\`\`\`
judge_verdict '{"leading":"proposer","score":{"proposer":7,"challenger":5},"reasoning":"clear argument structure","should_continue":true}'
\`\`\`

Pass the complete JSON as a single quoted argument. Do NOT omit any required fields.`;

let sessionCounter = 0;

/**
 * CodexAdapter implements the AgentAdapter interface for the Codex CLI app-server.
 *
 * Communicates via JSON-RPC over stdio. Uses dependency injection (client option)
 * to allow mock transport in tests.
 */
export class CodexAdapter implements AgentAdapter {
	readonly id = "codex";
	readonly capabilities: AdapterCapabilities = CODEX_CAPABILITIES;

	private readonly client: JsonRpcClient;
	private readonly listeners: Set<(e: NormalizedEvent) => void> = new Set();
	private readonly sessions: Map<string, SessionState> = new Map();
	private readonly pendingApprovals: Map<string, PendingApproval> = new Map();
	private notificationHandlerRegistered = false;

	constructor(options: CodexAdapterOptions) {
		if (options.client) {
			this.client = options.client;
		} else if (options.spawnFn) {
			const proc = options.spawnFn();
			this.client = new JsonRpcClient(
				proc.stdin as import("node:stream").Writable,
				proc.stdout as import("node:stream").Readable,
			);
		} else {
			throw new Error("CodexAdapter requires either client or spawnFn option");
		}
	}

	async startSession(input: StartSessionInput): Promise<SessionHandle> {
		sessionCounter++;
		const adapterSessionId = `codex-session-${sessionCounter}-${Date.now()}`;
		const model = input.model ?? "gpt-5.1-codex-mini";

		// 1. Send `initialize` request
		await this.client.request("initialize", {
			clientInfo: {
				name: "crossfire",
				title: "Crossfire",
				version: "0.1.0",
			},
			capabilities: { experimentalApi: true },
		});

		// 2. Send `initialized` notification
		this.client.notify("initialized");

		// 3. Send `thread/start` request
		const result = (await this.client.request("thread/start", {
			model,
			cwd: input.workingDirectory,
			approvalPolicy: "on-failure",
		})) as { thread: { id: string } };

		const providerSessionId = result.thread.id;

		const handle: SessionHandle = {
			adapterSessionId,
			providerSessionId,
			adapterId: "codex",
		};

		// Store session state (profile is stored but NOT sent to server)
		const sessionState: SessionState = {
			handle,
			profile: input.profile,
			model,
			turnCount: 0,
		};
		this.sessions.set(adapterSessionId, sessionState);

		// Register handlers (once)
		this.ensureNotificationHandlers(adapterSessionId);

		// Emit session.started
		this.emit({
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId,
			kind: "session.started",
			model,
			tools: [],
			providerSessionId,
			capabilities: this.capabilities,
		});

		return handle;
	}

	async sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle> {
		const session = this.sessions.get(handle.adapterSessionId);
		if (session) {
			session.currentTurnId = input.turnId;
			session.turnStartTime = Date.now();
		}

		// Append meta-tool instructions only on first turn so Codex knows how to call them
		// Subsequent turns use incremental prompts that don't need the instructions repeated
		const prompt =
			session?.turnCount === 0
				? input.prompt + META_TOOL_INSTRUCTIONS
				: input.prompt;

		// Send `turn/start` request
		const result = (await this.client.request("turn/start", {
			threadId: handle.providerSessionId,
			input: [{ type: "text", text: prompt }],
		})) as { turn: { id: string; status: string } };

		// Save native turn ID for interrupt and increment turn count
		if (session) {
			session.currentNativeTurnId = result.turn.id;
			session.turnCount++;
		}

		return {
			turnId: input.turnId,
			status: "running",
		};
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

			// Emit approval.resolved
			this.emit({
				timestamp: Date.now(),
				adapterId: "codex",
				adapterSessionId: pending.adapterSessionId,
				turnId: pending.turnId,
				kind: "approval.resolved",
				requestId: req.requestId,
				decision: req.decision,
			});

			// Resolve the server's blocked JSON-RPC request
			pending.resolveServerRequest({
				approved: req.decision === "allow" || req.decision === "allow-always",
			});
		}
	}

	async interrupt(turnId: string): Promise<void> {
		for (const [, session] of this.sessions) {
			if (session.currentTurnId === turnId) {
				await this.client.request("turn/interrupt", {
					threadId: session.handle.providerSessionId,
					turnId: session.currentNativeTurnId,
				});
				return;
			}
		}
	}

	async close(handle: SessionHandle): Promise<void> {
		this.sessions.delete(handle.adapterSessionId);
		// Clean up any pending approvals for this session
		for (const [id, pending] of this.pendingApprovals) {
			if (pending.adapterSessionId === handle.adapterSessionId) {
				this.pendingApprovals.delete(id);
			}
		}
		this.client.close();
	}

	private emit(event: NormalizedEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	/**
	 * Find the current session context for emitting events.
	 * Uses the session that has an active turn, or the first session.
	 */
	private getCurrentContext():
		| (MapContext & { turnStartTime?: number })
		| undefined {
		// Find session with active turn
		for (const [, session] of this.sessions) {
			if (session.currentTurnId) {
				return {
					adapterId: "codex",
					adapterSessionId: session.handle.adapterSessionId,
					turnId: session.currentTurnId,
					turnStartTime: session.turnStartTime,
				};
			}
		}
		return undefined;
	}

	/**
	 * Register the wildcard notification handler, approval request handlers,
	 * and transport error handler. Only registers once.
	 */
	private ensureNotificationHandlers(adapterSessionId: string): void {
		if (this.notificationHandlerRegistered) return;
		this.notificationHandlerRegistered = true;

		// Handle transport errors
		this.client.onError((err) => {
			const ctx = this.getCurrentContext();
			this.emit({
				timestamp: Date.now(),
				adapterId: "codex",
				adapterSessionId: ctx?.adapterSessionId ?? adapterSessionId,
				turnId: ctx?.turnId,
				kind: "run.error",
				message: err.message,
				recoverable: true,
			});
		});

		// Handle all notifications via wildcard
		this.client.onNotification("*", (method: unknown, params: unknown) => {
			const methodStr = method as string;
			const paramsObj = (params ?? {}) as Record<string, unknown>;
			const ctx = this.getCurrentContext();
			if (!ctx) return;

			// For turn.completed, attach durationMs from our tracking
			const events = mapCodexNotification(methodStr, paramsObj, ctx);
			for (const event of events) {
				if (event.kind === "turn.completed" && ctx.turnStartTime) {
					(event as { durationMs: number }).durationMs =
						Date.now() - ctx.turnStartTime;
				}
				this.emit(event);
			}
		});

		// Register approval request handlers for each approval method
		for (const [method, approvalType] of Object.entries(APPROVAL_METHODS)) {
			this.client.onRequest(method, async (params) => {
				const ctx = this.getCurrentContext();
				if (!ctx) return {};

				const paramsObj = (params ?? {}) as Record<string, unknown>;
				const requestId = `ar-${ctx.turnId}-${paramsObj.id ?? Date.now()}`;

				// Emit approval.request
				this.emit({
					timestamp: Date.now(),
					adapterId: "codex",
					adapterSessionId: ctx.adapterSessionId,
					turnId: ctx.turnId,
					kind: "approval.request",
					requestId,
					approvalType,
					title: String(
						paramsObj.command ?? paramsObj.path ?? paramsObj.prompt ?? method,
					),
					payload: paramsObj,
				});

				// Return a promise that blocks the JSON-RPC response until approve() is called
				return new Promise((resolve) => {
					this.pendingApprovals.set(requestId, {
						requestId,
						adapterSessionId: ctx.adapterSessionId,
						turnId: ctx.turnId!,
						resolveServerRequest: resolve,
					});
				});
			});
		}
	}
}
