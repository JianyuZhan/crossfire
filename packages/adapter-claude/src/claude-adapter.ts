import type {
	AdapterCapabilities,
	AgentAdapter,
	ApprovalCapabilities,
	ApprovalDecision,
	ApprovalOption,
	LocalTurnMetrics,
	NormalizedEvent,
	ResolvedPolicy,
	SessionHandle,
	StartSessionInput,
	TurnExecutionMode,
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
import { translatePolicy } from "./policy-translation.js";
import type {
	ClaudeCanUseToolOptions,
	ClaudePermissionMode,
	ClaudePermissionResult,
	ClaudePermissionUpdate,
	QueryFn,
	QueryResult,
	SdkMessage,
} from "./types.js";

/** Options for constructing a ClaudeAdapter */
export interface ClaudeAdapterOptions {
	queryFn: QueryFn;
}

interface ClaudeSessionConfig {
	model?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	baselinePolicy?: ResolvedPolicy;
}

/** Internal state for a running query within a session */
interface QueryContext {
	query: QueryResult;
	currentTurnId: string;
	pendingLocalMetrics?: LocalTurnMetrics;
	latestNonEmptyFinalText?: string;
	turnCompleted?: boolean;
}

/** Pending approval request state */
interface PendingApproval {
	requestId: string;
	adapterSessionId: string;
	turnId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	suggestions?: ClaudePermissionUpdate[];
	resolve: (value: ClaudePermissionResult) => void;
}

let sessionCounter = 0;

const CLAUDE_RESEARCH_ALLOWED_TOOLS = [
	"Read",
	"Grep",
	"Glob",
	"LS",
	"WebFetch",
	"Task",
];
const CLAUDE_RESEARCH_MAX_TURNS = 12;

function mapExecutionModeToClaudeQueryOptions(
	mode: TurnExecutionMode | undefined,
	toolConfig: {
		allowedTools?: string[];
		disallowedTools?: string[];
	},
): {
	permissionMode?: ClaudePermissionMode;
	allowDangerouslySkipPermissions?: boolean;
	maxTurns?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
} {
	switch (mode) {
		case "research":
			return {
				permissionMode: "dontAsk",
				maxTurns: CLAUDE_RESEARCH_MAX_TURNS,
				allowedTools: toolConfig.allowedTools ?? CLAUDE_RESEARCH_ALLOWED_TOOLS,
				disallowedTools: toolConfig.disallowedTools,
			};
		case "dangerous":
			return {
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				allowedTools: toolConfig.allowedTools,
				disallowedTools: toolConfig.disallowedTools,
			};
		case "plan":
			return {
				permissionMode: "plan",
				allowedTools: toolConfig.allowedTools,
				disallowedTools: toolConfig.disallowedTools,
			};
		case "guarded":
		case undefined:
			return {
				permissionMode: "default",
				allowedTools: toolConfig.allowedTools,
				disallowedTools: toolConfig.disallowedTools,
			};
	}
}

function buildApprovalOptions(): ApprovalOption[] {
	const options: ApprovalOption[] = [
		{
			id: "allow",
			label: "Allow once",
			kind: "allow",
			scope: "once",
			isDefault: true,
		},
		{
			id: "allow-session",
			label: "Allow for session",
			kind: "allow-always",
			scope: "session",
		},
		{
			id: "deny",
			label: "Reject",
			kind: "deny",
			isDefault: true,
		},
	];
	return options;
}

function buildApprovalCapabilities(
	suggestions?: ClaudePermissionUpdate[],
): ApprovalCapabilities {
	const supportedScopes = Array.from(
		new Set(
			(suggestions ?? [])
				.map((suggestion) => suggestion.destination)
				.map((destination) => {
					switch (destination) {
						case "session":
							return "session" as const;
						case "projectSettings":
							return "project" as const;
						case "userSettings":
							return "user" as const;
						case "localSettings":
							return "local" as const;
						case "cliArg":
							return "global" as const;
					}
				})
				.filter((scope) => scope !== undefined),
		),
	);
	if (!supportedScopes.includes("session")) {
		supportedScopes.unshift("session");
	}

	return {
		semanticOptions: buildApprovalOptions(),
		supportedScopes,
		supportsUpdatedInput: true,
	};
}

function buildSessionPermissionUpdates(
	toolName: string,
): ClaudePermissionUpdate[] {
	return [
		{
			type: "addRules",
			behavior: "allow",
			destination: "session",
			rules: [{ toolName }],
		},
	];
}

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
	private readonly sessionConfigs: Map<string, ClaudeSessionConfig> = new Map();

	constructor(options: ClaudeAdapterOptions) {
		this.queryFn = options.queryFn;
	}

	async startSession(input: StartSessionInput): Promise<SessionHandle> {
		sessionCounter++;
		const adapterSessionId = `claude-session-${sessionCounter}-${Date.now()}`;
		this.sessionConfigs.set(adapterSessionId, {
			model: input.model,
			allowedTools: input.allowedTools,
			disallowedTools: input.disallowedTools,
			baselinePolicy: input.policy,
		});
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
			options: ClaudeCanUseToolOptions,
		): Promise<ClaudePermissionResult> => {
			const toolUseId = options.toolUseID ?? String(Date.now());
			const requestId = `ar-${input.turnId}-${toolUseId}`;
			const approvalCapabilities = buildApprovalCapabilities(
				options.suggestions,
			);

			this.emit({
				...ctx,
				timestamp: Date.now(),
				kind: "approval.request",
				requestId,
				approvalType: "tool",
				title: `Approve tool: ${toolName}`,
				payload: {
					tool_name: toolName,
					tool_input: toolInput,
					suggestions: options.suggestions,
					blocked_path: options.blockedPath,
					decision_reason: options.decisionReason,
					agent_id: options.agentID,
				},
				suggestion: "allow",
				capabilities: approvalCapabilities,
			});

			return new Promise((resolve) => {
				this.pendingApprovals.set(requestId, {
					requestId,
					adapterSessionId: handle.adapterSessionId,
					turnId: input.turnId,
					toolName,
					toolInput,
					suggestions: options.suggestions,
					resolve,
				});
			});
		};

		const sessionConfig = this.sessionConfigs.get(handle.adapterSessionId);
		const activePolicy = input.policy ?? sessionConfig?.baselinePolicy;

		let queryOptions: Record<string, unknown>;
		if (activePolicy) {
			const { native, warnings } = translatePolicy(activePolicy);
			for (const w of warnings) {
				this.emit({
					kind: "run.warning",
					adapterId: "claude",
					adapterSessionId: handle.adapterSessionId,
					turnId: input.turnId,
					message: `[policy] ${w.field}: ${w.message}`,
					timestamp: Date.now(),
				});
			}
			queryOptions = {
				permissionMode: native.permissionMode,
				maxTurns: native.maxTurns,
				allowedTools: native.allowedTools,
				disallowedTools: native.disallowedTools,
				allowDangerouslySkipPermissions: native.allowDangerouslySkipPermissions,
			};
		} else {
			queryOptions = mapExecutionModeToClaudeQueryOptions(input.executionMode, {
				allowedTools: sessionConfig?.allowedTools,
				disallowedTools: sessionConfig?.disallowedTools,
			});
		}

		const query = this.queryFn({
			prompt: input.prompt,
			resume: handle.providerSessionId ?? undefined,
			model: sessionConfig?.model,
			...queryOptions,
			canUseTool,
			hooks,
		});

		this.queries.set(handle.adapterSessionId, {
			query,
			currentTurnId: input.turnId,
			pendingLocalMetrics: localMetrics,
			latestNonEmptyFinalText: undefined,
			turnCompleted: false,
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
				optionId: req.optionId,
			});

			if (req.decision === "deny" || req.optionId === "deny") {
				pending.resolve({
					behavior: "deny",
					message: "User denied tool use",
				});
				return;
			}

			const shouldPersist =
				req.decision === "allow-always" || req.optionId === "allow-session";
			pending.resolve({
				behavior: "allow",
				updatedInput:
					(req.updatedInput as Record<string, unknown> | undefined) ??
					pending.toolInput,
				...(shouldPersist
					? {
							updatedPermissions:
								pending.suggestions && pending.suggestions.length > 0
									? pending.suggestions
									: buildSessionPermissionUpdates(pending.toolName),
						}
					: {}),
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
		this.sessionConfigs.delete(handle.adapterSessionId);
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
				const queryCtx = this.queries.get(ctx.adapterSessionId);
				if (event.kind === "session.started") {
					handle.providerSessionId = event.providerSessionId;
				}
				if (event.kind === "usage.updated") {
					if (queryCtx?.pendingLocalMetrics) {
						event.localMetrics = queryCtx.pendingLocalMetrics;
					}
				}
				if (event.kind === "message.final") {
					if (event.text.trim().length === 0) {
						continue;
					}
					if (queryCtx) {
						queryCtx.latestNonEmptyFinalText = event.text;
					}
				}
				if (event.kind === "turn.completed") {
					if (queryCtx) {
						queryCtx.turnCompleted = true;
					}
					const role = turnInput.role ?? parseTurnId(turnInput.turnId).role;
					const roundNumber =
						turnInput.roundNumber ?? parseTurnId(turnInput.turnId).roundNumber;
					if (
						event.status === "completed" &&
						role &&
						roundNumber !== undefined &&
						queryCtx?.latestNonEmptyFinalText
					) {
						handle.transcript.push({
							roundNumber,
							role,
							content: queryCtx.latestNonEmptyFinalText,
						});
					}
					if (queryCtx) {
						queryCtx.latestNonEmptyFinalText = undefined;
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
			const queryCtx = this.queries.get(ctx.adapterSessionId);
			if (
				queryCtx?.currentTurnId === turnInput.turnId &&
				queryCtx.turnCompleted
			) {
				return;
			}
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

				// Reapply policy constraints so recovery runs under the same
				// permission mode, tool restrictions, and limits as the original turn
				const sessionConfig = this.sessionConfigs.get(handle.adapterSessionId);
				const recoveryPolicy =
					turnInput.policy ?? sessionConfig?.baselinePolicy;
				let recoveryOptions: Record<string, unknown> = {};
				if (recoveryPolicy) {
					const { native } = translatePolicy(recoveryPolicy);
					recoveryOptions = {
						permissionMode: native.permissionMode,
						maxTurns: native.maxTurns,
						allowedTools: native.allowedTools,
						disallowedTools: native.disallowedTools,
						allowDangerouslySkipPermissions:
							native.allowDangerouslySkipPermissions,
					};
				} else if (turnInput.executionMode) {
					recoveryOptions = mapExecutionModeToClaudeQueryOptions(
						turnInput.executionMode,
						{
							allowedTools: sessionConfig?.allowedTools,
							disallowedTools: sessionConfig?.disallowedTools,
						},
					);
				}

				const recoveryQuery = this.queryFn({
					prompt: buildTranscriptRecoveryPrompt({
						systemPrompt: handle.recoveryContext.systemPrompt,
						topic: handle.recoveryContext.topic,
						transcript: handle.transcript,
						schemaType: handle.recoveryContext.schemaType,
					}),
					resume: undefined,
					model: sessionConfig?.model,
					hooks,
					...recoveryOptions,
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
