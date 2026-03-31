import {
	type AdapterCapabilities,
	type AgentAdapter,
	type ApprovalCapabilities,
	type ApprovalDecision,
	type ApprovalOption,
	CODEX_CAPABILITIES,
	type LocalTurnMetrics,
	type NormalizedEvent,
	type RoleExecutionMode,
	type SessionHandle,
	type StartSessionInput,
	type TurnExecutionMode,
	type TurnHandle,
	type TurnInput,
	measureLocalMetrics,
	parseTurnId,
} from "@crossfire/adapter-core";
import { buildTranscriptRecoveryPrompt } from "@crossfire/orchestrator-core";
import { type MapContext, mapCodexNotification } from "./event-mapper.js";
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
	executionMode: RoleExecutionMode;
	currentTurnId?: string;
	currentNativeTurnId?: string;
	turnStartTime?: number;
	turnCount: number;
	currentTurnRole?: "proposer" | "challenger" | "judge";
	currentTurnRoundNumber?: number;
	pendingLocalMetrics?: LocalTurnMetrics;
}

/** Pending approval request */
interface PendingApproval {
	requestId: string;
	adapterSessionId: string;
	turnId: string;
	options?: ApprovalOption[];
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

function mapExecutionModeToCodexPolicies(
	mode: TurnExecutionMode | RoleExecutionMode | undefined,
): {
	approvalPolicy: string;
	sandboxPolicy?: Record<string, unknown>;
} {
	switch (mode) {
		case "research":
		case "plan":
			return {
				approvalPolicy: "on-request",
				sandboxPolicy: { type: "readOnly" },
			};
		case "dangerous":
			return {
				approvalPolicy: "never",
				sandboxPolicy: { type: "danger-full-access" },
			};
		case "guarded":
		case undefined:
			return {
				approvalPolicy: "on-failure",
			};
	}
}

function humanizeDecision(decisionId: string): string {
	return decisionId
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/^\w/, (ch) => ch.toUpperCase());
}

function mapDecisionKind(decisionId: string): ApprovalOption["kind"] {
	const normalized = decisionId.toLowerCase();
	if (
		normalized.includes("decline") ||
		normalized.includes("reject") ||
		normalized.includes("deny") ||
		normalized.includes("cancel")
	) {
		return "deny";
	}
	if (
		normalized.includes("acceptforsession") ||
		normalized.includes("allow_always") ||
		normalized.includes("allowalways") ||
		normalized.includes("always")
	) {
		return "allow-always";
	}
	if (
		normalized.includes("accept") ||
		normalized.includes("allow") ||
		normalized.includes("grant") ||
		normalized.includes("apply")
	) {
		return "allow";
	}
	return "other";
}

function mapDecisionScope(
	decisionId: string,
): ApprovalOption["scope"] | undefined {
	const normalized = decisionId.toLowerCase();
	if (normalized.includes("session")) return "session";
	return undefined;
}

function extractApprovalOptions(
	params: Record<string, unknown>,
): ApprovalOption[] | undefined {
	const rawOptions = params.availableDecisions;
	if (!Array.isArray(rawOptions) || rawOptions.length === 0) return undefined;

	const options: ApprovalOption[] = [];
	for (let index = 0; index < rawOptions.length; index++) {
		const rawOption = rawOptions[index];
		if (typeof rawOption === "string") {
			options.push({
				id: rawOption,
				label: humanizeDecision(rawOption),
				kind: mapDecisionKind(rawOption),
				scope: mapDecisionScope(rawOption),
				isDefault: index === 0,
			});
			continue;
		}
		if (typeof rawOption !== "object" || rawOption === null) continue;
		const option = rawOption as Record<string, unknown>;
		const idValue = option.id ?? option.decision ?? option.kind ?? option.name;
		if (typeof idValue !== "string" || idValue.length === 0) continue;
		const label =
			typeof option.label === "string"
				? option.label
				: typeof option.title === "string"
					? option.title
					: typeof option.name === "string"
						? option.name
						: humanizeDecision(idValue);
		options.push({
			id: idValue,
			label,
			kind: mapDecisionKind(idValue),
			scope:
				typeof option.scope === "string"
					? (option.scope as ApprovalOption["scope"])
					: mapDecisionScope(idValue),
			isDefault:
				typeof option.isDefault === "boolean"
					? option.isDefault
					: typeof option.default === "boolean"
						? option.default
						: index === 0,
		});
	}

	return options.length > 0 ? options : undefined;
}

function buildSemanticOptions(
	nativeOptions?: ApprovalOption[],
): ApprovalOption[] | undefined {
	if (!nativeOptions || nativeOptions.length === 0) return undefined;

	const semanticOptions: ApprovalOption[] = [];
	const allowOption = nativeOptions.find((option) => option.kind === "allow");
	if (allowOption) {
		semanticOptions.push({
			id: "allow",
			label: "Allow once",
			kind: "allow",
			scope: "once",
			isDefault: allowOption.isDefault,
		});
	}
	const allowAlwaysOption = nativeOptions.find(
		(option) => option.kind === "allow-always",
	);
	if (allowAlwaysOption) {
		semanticOptions.push({
			id:
				allowAlwaysOption.scope === "session"
					? "allow-session"
					: "allow-persistent",
			label:
				allowAlwaysOption.scope === "session"
					? "Allow for session"
					: "Allow persistently",
			kind: "allow-always",
			scope: allowAlwaysOption.scope,
			isDefault: allowAlwaysOption.isDefault,
		});
	}
	const denyOption = nativeOptions.find((option) => option.kind === "deny");
	if (denyOption) {
		semanticOptions.push({
			id: "deny",
			label: "Reject",
			kind: "deny",
			scope: "once",
			isDefault: denyOption.isDefault,
		});
	}

	return semanticOptions.length > 0 ? semanticOptions : undefined;
}

function buildApprovalCapabilities(
	nativeOptions?: ApprovalOption[],
): ApprovalCapabilities | undefined {
	if (!nativeOptions || nativeOptions.length === 0) return undefined;
	return {
		semanticOptions: buildSemanticOptions(nativeOptions),
		nativeOptions,
		supportedScopes: Array.from(
			new Set(
				nativeOptions
					.map((option) => option.scope)
					.filter((scope) => scope !== undefined),
			),
		),
		supportsUpdatedInput: false,
	};
}

function findSelectedOption(
	pending: PendingApproval,
	req: ApprovalDecision,
): ApprovalOption | undefined {
	if (req.optionId) {
		return pending.options?.find((option) => option.id === req.optionId);
	}
	if (req.decision === "allow-always") {
		return pending.options?.find((option) => option.kind === "allow-always");
	}
	if (req.decision === "deny") {
		return pending.options?.find((option) => option.kind === "deny");
	}
	return (
		pending.options?.find(
			(option) => option.isDefault && option.kind !== "deny",
		) ?? pending.options?.find((option) => option.kind === "allow")
	);
}

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
		const model = input.model ?? "gpt-5.4";
		const executionMode = input.executionMode ?? "guarded";
		const policies = mapExecutionModeToCodexPolicies(executionMode);

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
			approvalPolicy: policies.approvalPolicy,
			...(policies.sandboxPolicy
				? { sandboxPolicy: policies.sandboxPolicy }
				: {}),
		})) as { thread: { id: string } };

		const providerSessionId = result.thread.id;

		const handle: SessionHandle = {
			adapterSessionId,
			providerSessionId,
			adapterId: "codex",
			transcript: [],
		};

		// Store session state (profile is stored but NOT sent to server)
		const sessionState: SessionState = {
			handle,
			profile: input.profile,
			model,
			executionMode,
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
			const parsed = parseTurnId(input.turnId);
			session.currentTurnRole = input.role ?? parsed.role;
			session.currentTurnRoundNumber = input.roundNumber ?? parsed.roundNumber;
		}

		// Append meta-tool instructions only on first turn
		const isFirstTurn = session?.turnCount === 0;
		const prompt = isFirstTurn
			? input.prompt + META_TOOL_INSTRUCTIONS
			: input.prompt;

		const overheadText = isFirstTurn ? META_TOOL_INSTRUCTIONS : "";
		const localMetrics = measureLocalMetrics(input.prompt, overheadText);
		if (session) {
			session.pendingLocalMetrics = localMetrics;
		}
		const policies = mapExecutionModeToCodexPolicies(
			input.executionMode ?? session?.executionMode,
		);

		try {
			await this.startTurnOnThread(
				handle.providerSessionId,
				prompt,
				session,
				input.turnId,
				policies,
			);
			return { turnId: input.turnId, status: "running" };
		} catch (err) {
			if (!handle.recoveryContext) throw err;
			return this.recoverTurn(handle, session, input, err);
		}
	}

	/**
	 * Send turn/start on a given thread, updating session state on success.
	 */
	private async startTurnOnThread(
		threadId: string | undefined,
		prompt: string,
		session: SessionState | undefined,
		turnId: string,
		policies?: {
			approvalPolicy: string;
			sandboxPolicy?: Record<string, unknown>;
		},
	): Promise<void> {
		const result = (await this.client.request("turn/start", {
			threadId,
			input: [{ type: "text", text: prompt }],
			approvalPolicy: policies?.approvalPolicy,
			...(policies?.sandboxPolicy
				? { sandboxPolicy: policies.sandboxPolicy }
				: {}),
		})) as { turn: { id: string; status: string } };

		if (session) {
			session.currentNativeTurnId = result.turn.id;
			session.turnCount++;
		}
	}

	/**
	 * Recover from a failed turn/start by creating a new thread
	 * and replaying transcript context.
	 */
	private async recoverTurn(
		handle: SessionHandle,
		session: SessionState | undefined,
		input: TurnInput,
		err: unknown,
	): Promise<TurnHandle> {
		const recovery = handle.recoveryContext;
		if (!recovery) {
			throw err;
		}
		const message = err instanceof Error ? err.message : String(err);

		this.emit({
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: handle.adapterSessionId,
			turnId: input.turnId,
			kind: "run.warning",
			message: `turn/start failed (${message}), attempting transcript recovery`,
		});

		// Create a new thread
		const recoveryPolicies = mapExecutionModeToCodexPolicies(
			input.executionMode ?? session?.executionMode,
		);
		const threadResult = (await this.client.request("thread/start", {
			model: session?.model ?? "gpt-5.4",
			cwd: "/tmp",
			approvalPolicy: recoveryPolicies.approvalPolicy,
			...(recoveryPolicies.sandboxPolicy
				? { sandboxPolicy: recoveryPolicies.sandboxPolicy }
				: {}),
		})) as { thread: { id: string } };

		const newThreadId = threadResult.thread.id;
		handle.providerSessionId = newThreadId;
		if (session) {
			session.handle.providerSessionId = newThreadId;
		}

		const recoveryPrompt =
			buildTranscriptRecoveryPrompt({
				systemPrompt: recovery.systemPrompt,
				topic: recovery.topic,
				transcript: handle.transcript,
				schemaType: recovery.schemaType,
			}) + META_TOOL_INSTRUCTIONS;

		await this.startTurnOnThread(
			newThreadId,
			recoveryPrompt,
			session,
			input.turnId,
			recoveryPolicies,
		);
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
		if (!pending) return;

		this.pendingApprovals.delete(req.requestId);

		this.emit({
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: pending.adapterSessionId,
			turnId: pending.turnId,
			kind: "approval.resolved",
			requestId: req.requestId,
			decision: req.decision,
			optionId: req.optionId,
		});

		const selectedOption = findSelectedOption(pending, req);
		if (selectedOption) {
			pending.resolveServerRequest({
				decision: selectedOption.id,
			});
			return;
		}

		pending.resolveServerRequest({
			approved: req.decision === "allow" || req.decision === "allow-always",
		});
	}

	async interrupt(turnId: string): Promise<void> {
		const session = this.findSessionByTurnId(turnId);
		if (!session) return;

		await this.client.request("turn/interrupt", {
			threadId: session.handle.providerSessionId,
			turnId: session.currentNativeTurnId,
		});
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

	/** Find a session that has the given active turn ID */
	private findSessionByTurnId(turnId: string): SessionState | undefined {
		for (const session of this.sessions.values()) {
			if (session.currentTurnId === turnId) return session;
		}
		return undefined;
	}

	/**
	 * Find the current session context for emitting events.
	 * Returns the first session with an active turn.
	 */
	private getCurrentContext():
		| (MapContext & { turnStartTime?: number })
		| undefined {
		for (const session of this.sessions.values()) {
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
			const ctx = this.getCurrentContext();
			if (!ctx) return;

			const methodStr = method as string;
			const paramsObj = (params ?? {}) as Record<string, unknown>;
			const session = this.sessions.get(ctx.adapterSessionId);
			const events = mapCodexNotification(methodStr, paramsObj, ctx);

			for (const event of events) {
				if (event.kind === "turn.completed" && ctx.turnStartTime) {
					(event as { durationMs: number }).durationMs =
						Date.now() - ctx.turnStartTime;
				}
				if (event.kind === "usage.updated" && session?.pendingLocalMetrics) {
					event.localMetrics = session.pendingLocalMetrics;
				}
				if (
					event.kind === "message.final" &&
					session?.currentTurnRole &&
					session.currentTurnRoundNumber !== undefined
				) {
					session.handle.transcript.push({
						roundNumber: session.currentTurnRoundNumber,
						role: session.currentTurnRole,
						content: event.text,
					});
				}
				this.emit(event);
			}
		});

		// Register approval request handlers for each approval method
		for (const [method, approvalType] of Object.entries(APPROVAL_METHODS)) {
			this.client.onRequest(method, async (params) => {
				const ctx = this.getCurrentContext();
				if (!ctx) return {};
				const pendingTurnId = ctx.turnId ?? "unknown-turn";

				const paramsObj = (params ?? {}) as Record<string, unknown>;
				const requestId = `ar-${pendingTurnId}-${paramsObj.id ?? Date.now()}`;
				const options = extractApprovalOptions(paramsObj);
				const approvalCapabilities = buildApprovalCapabilities(options);

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
					capabilities: approvalCapabilities,
				});

				// Return a promise that blocks the JSON-RPC response until approve() is called
				return new Promise((resolve) => {
					this.pendingApprovals.set(requestId, {
						requestId,
						adapterSessionId: ctx.adapterSessionId,
						turnId: pendingTurnId,
						options,
						resolveServerRequest: resolve,
					});
				});
			});
		}
	}
}
