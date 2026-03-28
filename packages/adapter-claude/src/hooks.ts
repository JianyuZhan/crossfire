import type { NormalizedEvent } from "@crossfire/adapter-core";

interface HookContext {
	adapterId: "claude";
	adapterSessionId: string;
}

/**
 * SDK HookInput — the first argument to every hook callback.
 * We use a loose type to avoid coupling to SDK internals.
 */
type HookInput = Record<string, unknown>;

/**
 * SDK HookJSONOutput — return value from hook callbacks.
 * `{ continue: true }` tells the SDK to proceed normally.
 */
type HookJSONOutput = { continue?: boolean; [key: string]: unknown };

/**
 * SDK HookCallback signature (claude-agent-sdk@0.1.77+):
 *   (input: HookInput, toolUseID: string | undefined, options: { signal }) => Promise<HookJSONOutput>
 */
type HookCallback = (
	input: HookInput,
	toolUseID: string | undefined,
	options: { signal: AbortSignal },
) => Promise<HookJSONOutput>;

/**
 * SDK HookCallbackMatcher (claude-agent-sdk@0.1.77+):
 *   { matcher?: string; hooks: HookCallback[]; timeout?: number }
 */
interface HookCallbackMatcher {
	matcher?: string;
	hooks: HookCallback[];
	timeout?: number;
}

/**
 * Builds Claude SDK hooks that emit NormalizedEvents via the provided emit function.
 *
 * Hook callbacks translate SDK-level tool/subagent lifecycle events into
 * adapter-core NormalizedEvent types (tool.call, tool.result, subagent.started, etc.).
 *
 * @param emit - Function to emit NormalizedEvents to subscribers
 * @param ctx - Adapter context with adapterId and adapterSessionId
 * @param getTurnId - Getter for the current turn ID (dynamically resolved)
 * @returns Hooks object in the format expected by Claude SDK: Record<HookName, HookCallbackMatcher[]>
 */
export function buildHooks(
	emit: (e: NormalizedEvent) => void,
	ctx: HookContext,
	getTurnId: () => string,
): Record<string, HookCallbackMatcher[]> {
	const base = () => ({
		timestamp: Date.now(),
		adapterId: ctx.adapterId,
		adapterSessionId: ctx.adapterSessionId,
		turnId: getTurnId(),
	});

	const CONTINUE: HookJSONOutput = { continue: true };

	return {
		PreToolUse: [
			{
				hooks: [
					async (input: HookInput, toolUseID: string | undefined) => {
						emit({
							...base(),
							kind: "tool.call",
							toolUseId:
								toolUseID ?? (input.tool_use_id as string) ?? "unknown",
							toolName: (input.tool_name as string) ?? "unknown",
							input: input.tool_input,
						});
						return CONTINUE;
					},
				],
			},
		],

		PostToolUse: [
			{
				hooks: [
					async (input: HookInput, toolUseID: string | undefined) => {
						emit({
							...base(),
							kind: "tool.result",
							toolUseId:
								toolUseID ?? (input.tool_use_id as string) ?? "unknown",
							toolName: (input.tool_name as string) ?? "unknown",
							success: true,
							output: input.tool_response ?? input.tool_output,
						});
						return CONTINUE;
					},
				],
			},
		],

		PostToolUseFailure: [
			{
				hooks: [
					async (input: HookInput, toolUseID: string | undefined) => {
						emit({
							...base(),
							kind: "tool.result",
							toolUseId:
								toolUseID ?? (input.tool_use_id as string) ?? "unknown",
							toolName: (input.tool_name as string) ?? "unknown",
							success: false,
							error: input.error as string,
						});
						return CONTINUE;
					},
				],
			},
		],

		SubagentStart: [
			{
				hooks: [
					async (input: HookInput) => {
						emit({
							...base(),
							kind: "subagent.started",
							subagentId: (input.agent_id as string) ?? "unknown",
							description: input.agent_type as string | undefined,
						});
						return CONTINUE;
					},
				],
			},
		],

		SubagentStop: [
			{
				hooks: [
					async (input: HookInput) => {
						emit({
							...base(),
							kind: "subagent.completed",
							subagentId: (input.agent_id as string) ?? "unknown",
						});
						return CONTINUE;
					},
				],
			},
		],
	};
}
