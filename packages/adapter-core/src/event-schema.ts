import { z } from "zod";

// Base schemas
const AdapterIdSchema = z.enum(["claude", "codex", "gemini"]);

const BaseEventFields = {
	kind: z.string(),
	timestamp: z.number(),
	adapterId: AdapterIdSchema,
	adapterSessionId: z.string(),
	turnId: z.string().optional(),
};

const AdapterCapabilitiesSchema = z.object({
	supportsResume: z.boolean(),
	resumeMode: z.enum(["protocol-native", "native-cli", "stateless"]),
	resumeStability: z.enum(["stable", "experimental", "none"]),
	supportsExternalHistoryInjection: z.boolean(),
	supportsRawThinking: z.boolean(),
	supportsReasoningSummary: z.boolean(),
	supportsPlan: z.boolean(),
	supportsApproval: z.boolean(),
	supportsInterrupt: z.boolean(),
	supportsSubagents: z.boolean(),
	supportsStreamingDelta: z.boolean(),
});

// Session lifecycle
const SessionStartedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("session.started"),
	model: z.string(),
	tools: z.array(z.string()),
	providerSessionId: z.string(),
	capabilities: AdapterCapabilitiesSchema,
});

// Text stream
const MessageDeltaSchema = z.object({
	...BaseEventFields,
	kind: z.literal("message.delta"),
	text: z.string(),
	role: z.literal("assistant"),
});

const MessageFinalSchema = z.object({
	...BaseEventFields,
	kind: z.literal("message.final"),
	text: z.string(),
	role: z.literal("assistant"),
	stopReason: z.string().optional(),
});

// Thinking / reasoning
const ThinkingDeltaSchema = z.object({
	...BaseEventFields,
	kind: z.literal("thinking.delta"),
	text: z.string(),
	thinkingType: z.enum(["raw-thinking", "reasoning-summary"]),
});

// Plan
const PlanUpdatedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("plan.updated"),
	steps: z.array(
		z.object({
			description: z.string(),
			status: z.enum(["pending", "in_progress", "completed", "failed"]),
		}),
	),
});

// Tool lifecycle
const ToolCallSchema = z.object({
	...BaseEventFields,
	kind: z.literal("tool.call"),
	toolUseId: z.string(),
	toolName: z.string(),
	input: z.unknown(),
});

const ToolProgressSchema = z.object({
	...BaseEventFields,
	kind: z.literal("tool.progress"),
	toolUseId: z.string(),
	toolName: z.string(),
	elapsedSeconds: z.number(),
});

const ToolResultSchema = z.object({
	...BaseEventFields,
	kind: z.literal("tool.result"),
	toolUseId: z.string(),
	toolName: z.string(),
	success: z.boolean(),
	output: z.unknown().optional(),
	error: z.string().optional(),
});

const ToolDeniedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("tool.denied"),
	toolUseId: z.string(),
	toolName: z.string(),
	input: z.unknown(),
});

// Approval
const ApprovalOptionSchema = z.object({
	id: z.string(),
	label: z.string(),
	kind: z.enum(["allow", "deny", "allow-always", "other"]),
	scope: z
		.enum(["once", "session", "project", "user", "local", "global"])
		.optional(),
	isDefault: z.boolean().optional(),
});

const ApprovalCapabilitiesSchema = z.object({
	semanticOptions: z.array(ApprovalOptionSchema).optional(),
	nativeOptions: z.array(ApprovalOptionSchema).optional(),
	supportedScopes: z
		.array(z.enum(["once", "session", "project", "user", "local", "global"]))
		.optional(),
	supportsUpdatedInput: z.boolean().optional(),
});

const StartSessionInputSchema = z.object({
	profile: z.string(),
	workingDirectory: z.string(),
	model: z.string().optional(),
	mcpServers: z.record(z.string(), z.unknown()).optional(),
	permissionMode: z.enum(["auto", "approve-all", "deny-all"]).optional(),
	providerOptions: z.record(z.string(), z.unknown()).optional(),
});

const TurnInputSchema = z.object({
	prompt: z.string(),
	turnId: z.string(),
	timeout: z.number().optional(),
	role: z.enum(["proposer", "challenger", "judge"]).optional(),
	roundNumber: z.number().optional(),
});

const ApprovalRequestSchema = z.object({
	...BaseEventFields,
	kind: z.literal("approval.request"),
	requestId: z.string(),
	approvalType: z.enum(["tool", "command", "file-change", "user-input"]),
	title: z.string(),
	payload: z.unknown(),
	suggestion: z.enum(["allow", "deny"]).optional(),
	capabilities: ApprovalCapabilitiesSchema.optional(),
});

const ApprovalResolvedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("approval.resolved"),
	requestId: z.string(),
	decision: z.enum(["allow", "deny", "allow-always"]),
	optionId: z.string().optional(),
});

// Subagent
const SubagentStartedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("subagent.started"),
	subagentId: z.string(),
	description: z.string().optional(),
});

const SubagentCompletedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("subagent.completed"),
	subagentId: z.string(),
});

// Usage
const ProviderUsageSemanticsSchema = z.enum([
	"per_turn",
	"cumulative_thread_total",
	"session_delta_or_cached",
	"unknown",
]);

const LocalTurnMetricsSchema = z.object({
	semanticChars: z.number(),
	semanticUtf8Bytes: z.number(),
	adapterOverheadChars: z.number(),
	adapterOverheadUtf8Bytes: z.number(),
	totalChars: z.number(),
	totalUtf8Bytes: z.number(),
	totalTokensEstimate: z.number().optional(),
	tokenEstimateMethod: z.string().optional(),
});

const UsageFields = {
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalCostUsd: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	semantics: ProviderUsageSemanticsSchema.optional(),
	localMetrics: LocalTurnMetricsSchema.optional(),
};

const UsageUpdatedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("usage.updated"),
	...UsageFields,
});

// Turn completion
const TurnCompletedSchema = z.object({
	...BaseEventFields,
	kind: z.literal("turn.completed"),
	status: z.enum(["completed", "interrupted", "failed", "timeout"]),
	durationMs: z.number(),
	usage: z.object(UsageFields).optional(),
});

// Errors
const RunErrorSchema = z.object({
	...BaseEventFields,
	kind: z.literal("run.error"),
	message: z.string(),
	recoverable: z.boolean(),
});

const RunWarningSchema = z.object({
	...BaseEventFields,
	kind: z.literal("run.warning"),
	message: z.string(),
});

// Known event schemas (16 total)
const KnownEventSchema = z.discriminatedUnion("kind", [
	SessionStartedSchema,
	MessageDeltaSchema,
	MessageFinalSchema,
	ThinkingDeltaSchema,
	PlanUpdatedSchema,
	ToolCallSchema,
	ToolProgressSchema,
	ToolResultSchema,
	ToolDeniedSchema,
	ApprovalRequestSchema,
	ApprovalResolvedSchema,
	SubagentStartedSchema,
	SubagentCompletedSchema,
	UsageUpdatedSchema,
	TurnCompletedSchema,
	RunErrorSchema,
	RunWarningSchema,
]);

// Fallback for unknown kinds (forward compat)
const UnknownEventSchema = z
	.object({
		...BaseEventFields,
	})
	.passthrough();

// Union: try known first, fall back to unknown
export const NormalizedEventSchema = z.union([
	KnownEventSchema,
	UnknownEventSchema,
]);

export const AdapterContractSchema = z.object({
	startSessionInput: StartSessionInputSchema,
	turnInput: TurnInputSchema,
});
