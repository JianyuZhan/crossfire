import type { NormalizedEvent } from "@crossfire/adapter-core";

export interface MapContext {
	adapterId: "codex";
	adapterSessionId: string;
	turnId?: string;
}

/** Known meta-tool names that map to structured tool calls */
const META_TOOLS = new Set(["debate_meta", "judge_verdict"]);

/** Extract the item object and its id from Codex notification params */
function extractItem(params: Record<string, unknown>): {
	item: Record<string, unknown>;
	id: string;
	type: unknown;
} {
	const item = (params.item ?? params) as Record<string, unknown>;
	return {
		item,
		id: String(item.id ?? params.id ?? ""),
		type: item.type,
	};
}

function detectMetaTool(command: string): string | null {
	for (const tool of META_TOOLS) {
		if (command.includes(tool)) return tool;
	}
	return null;
}

/** Try to parse JSON from a string, returning undefined on failure. */
function tryParseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

/**
 * Maps Codex JSON-RPC notifications to NormalizedEvent[].
 * Pure function with no side effects.
 */
export function mapCodexNotification(
	method: string,
	params: Record<string, unknown>,
	ctx: MapContext,
): NormalizedEvent[] {
	const timestamp = Date.now();
	const base = {
		timestamp,
		adapterId: ctx.adapterId,
		adapterSessionId: ctx.adapterSessionId,
		turnId: ctx.turnId,
	};

	// Suppress output deltas
	if (
		method === "item/commandExecution/outputDelta" ||
		method === "item/fileChange/outputDelta"
	) {
		return [];
	}

	switch (method) {
		case "item/agentMessage/delta": {
			const text = String(params.text ?? "");
			if (text.length === 0) return [];
			return [
				{
					...base,
					kind: "message.delta",
					text,
					role: "assistant",
				} satisfies NormalizedEvent,
			];
		}

		case "item/reasoning/summaryTextDelta": {
			const text = String(params.text ?? "");
			if (text.length === 0) return [];
			return [
				{
					...base,
					kind: "thinking.delta",
					text,
					thinkingType: "reasoning-summary",
				} satisfies NormalizedEvent,
			];
		}

		case "item/started": {
			const { item, id, type } = extractItem(params);

			if (type === "commandExecution") {
				const command = String(item.command ?? "");
				const metaToolName = detectMetaTool(command);

				return [
					{
						...base,
						kind: "tool.call",
						toolUseId: id,
						toolName: metaToolName ?? "shell",
						input: params,
					} satisfies NormalizedEvent,
				];
			}

			if (type === "fileChange") {
				return [
					{
						...base,
						kind: "tool.call",
						toolUseId: id,
						toolName: "file_edit",
						input: params,
					} satisfies NormalizedEvent,
				];
			}

			return [];
		}

		case "item/completed": {
			const { item, id, type } = extractItem(params);

			if (type === "agentMessage") {
				// Extract text from content array or flat text field
				const content = item.content as
					| Array<{ type: string; text?: string }>
					| undefined;
				const text = content
					? content
							.filter((b) => b.type === "text" && b.text)
							.map((b) => b.text)
							.join("")
					: String(item.text ?? "");
				return [
					{
						...base,
						kind: "message.final",
						text,
						role: "assistant",
						stopReason: String(item.phase ?? ""),
					} satisfies NormalizedEvent,
				];
			}

			if (type === "commandExecution") {
				const command = String(item.command ?? "");
				const metaToolName = detectMetaTool(command);
				const exitCode = (item.exitCode ?? params.exitCode) as
					| number
					| undefined;
				const success = exitCode === undefined || exitCode === 0;
				const toolName = metaToolName ?? "shell";

				const events: NormalizedEvent[] = [];

				// For meta-tools, parse JSON from output and emit a tool.call
				// with the structured input so the projection can extract meta data.
				if (metaToolName && success) {
					const outputText = String(item.aggregatedOutput ?? item.output ?? "");
					const parsed = tryParseJson(outputText);
					if (parsed) {
						events.push({
							...base,
							kind: "tool.call",
							toolUseId: id,
							toolName: metaToolName,
							input: parsed,
						} satisfies NormalizedEvent);
					}
				}

				events.push({
					...base,
					kind: "tool.result",
					toolUseId: id,
					toolName,
					success,
					output: item.output ?? params.output,
					error: success
						? undefined
						: String(item.error ?? params.error ?? `Exit code: ${exitCode}`),
				} satisfies NormalizedEvent);

				return events;
			}

			if (type === "fileChange") {
				return [
					{
						...base,
						kind: "tool.result",
						toolUseId: id,
						toolName: "file_edit",
						success: true,
						output: params,
					} satisfies NormalizedEvent,
				];
			}

			return [];
		}

		case "turn/plan/updated": {
			const steps = (params.steps as Array<Record<string, unknown>>) ?? [];

			return [
				{
					...base,
					kind: "plan.updated",
					steps: steps.map((s) => ({
						description: String(s.step ?? ""),
						status:
							s.status === "inProgress"
								? "in_progress"
								: String(s.status ?? "pending"),
					})) as Array<{
						description: string;
						status: "pending" | "in_progress" | "completed" | "failed";
					}>,
				} satisfies NormalizedEvent,
			];
		}

		case "error": {
			const errObj = params.error as Record<string, unknown> | undefined;
			return [
				{
					...base,
					kind: "run.error",
					message: String(errObj?.message ?? "Unknown codex error"),
					recoverable: !!params.willRetry,
				} satisfies NormalizedEvent,
			];
		}

		case "turn/completed": {
			const turn = (params.turn ?? params) as Record<string, unknown>;
			const rawStatus = String(turn.status ?? params.status ?? "completed");
			// Codex uses "inProgress", "completed", "failed" etc.
			const status = (rawStatus === "inProgress" ? "completed" : rawStatus) as
				| "completed"
				| "interrupted"
				| "failed"
				| "timeout";
			return [
				{
					...base,
					kind: "turn.completed",
					status,
					durationMs: 0,
				} satisfies NormalizedEvent,
			];
		}

		case "thread/tokenUsage/updated": {
			// Real format: params.tokenUsage.total.{inputTokens, outputTokens}
			// Test compat: params.{inputTokens, outputTokens}
			const usage = (params.tokenUsage as Record<string, unknown>)?.total as
				| Record<string, unknown>
				| undefined;
			const inputTokens = Number(usage?.inputTokens ?? params.inputTokens ?? 0);
			const outputTokens = Number(
				usage?.outputTokens ?? params.outputTokens ?? 0,
			);
			return [
				{
					...base,
					kind: "usage.updated",
					inputTokens,
					outputTokens,
					totalCostUsd:
						params.totalCostUsd !== undefined
							? Number(params.totalCostUsd)
							: undefined,
					semantics: "cumulative_thread_total" as const,
				} satisfies NormalizedEvent,
			];
		}

		default:
			return [];
	}
}
