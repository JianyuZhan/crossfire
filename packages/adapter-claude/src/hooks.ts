import type { NormalizedEvent } from "@crossfire/adapter-core";

interface HookContext {
	adapterId: "claude";
	adapterSessionId: string;
}

interface HookCallbackMatcher {
	callback: (info: Record<string, unknown>) => void;
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

	return {
		PreToolUse: [
			{
				callback: (info: Record<string, unknown>) => {
					emit({
						...base(),
						kind: "tool.call",
						toolUseId: info.tool_use_id as string,
						toolName: info.tool_name as string,
						input: info.tool_input,
					});
				},
			},
		],

		PostToolUse: [
			{
				callback: (info: Record<string, unknown>) => {
					emit({
						...base(),
						kind: "tool.result",
						toolUseId: info.tool_use_id as string,
						toolName: info.tool_name as string,
						success: true,
						output: info.tool_output,
					});
				},
			},
		],

		PostToolUseFailure: [
			{
				callback: (info: Record<string, unknown>) => {
					emit({
						...base(),
						kind: "tool.result",
						toolUseId: info.tool_use_id as string,
						toolName: info.tool_name as string,
						success: false,
						error: info.error as string,
					});
				},
			},
		],

		SubagentStart: [
			{
				callback: (info: Record<string, unknown>) => {
					emit({
						...base(),
						kind: "subagent.started",
						subagentId: info.subagent_id as string,
						description: info.description as string | undefined,
					});
				},
			},
		],

		SubagentStop: [
			{
				callback: (info: Record<string, unknown>) => {
					emit({
						...base(),
						kind: "subagent.completed",
						subagentId: info.subagent_id as string,
					});
				},
			},
		],
	};
}
