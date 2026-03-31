import type { NormalizedEvent } from "@crossfire/adapter-core";
import { CLAUDE_CAPABILITIES } from "@crossfire/adapter-core";
import type { SdkMessage } from "./types.js";

interface MapContext {
	adapterId: "claude";
	adapterSessionId: string;
	turnId: string;
}

/**
 * Extract text content from an assistant message.
 *
 * The SDK sends `{ type: 'assistant', message: APIAssistantMessage }` where
 * `message.content` is an array of content blocks. We also handle the
 * simplified format `{ type: 'assistant', content: string }` used in tests.
 */
function extractAssistantText(msg: SdkMessage): string {
	const apiMsg = msg.message as { content?: unknown } | undefined;
	if (apiMsg?.content) {
		if (typeof apiMsg.content === "string") return apiMsg.content;
		if (Array.isArray(apiMsg.content)) {
			return apiMsg.content
				.filter(
					(b: { type: string; text?: string }) => b.type === "text" && b.text,
				)
				.map((b: { text: string }) => b.text)
				.join("");
		}
	}
	if (typeof msg.content === "string") return msg.content;
	return "";
}

function extractStopReason(msg: SdkMessage): string | undefined {
	const apiMsg = msg.message as { stop_reason?: string } | undefined;
	if (apiMsg?.stop_reason) return apiMsg.stop_reason;
	return msg.stopReason as string | undefined;
}

/**
 * Map a content block delta to NormalizedEvents.
 * Shared by both the `stream_event` wrapper and raw `content_block_delta` paths.
 */
function mapDelta(
	delta: { type: string; text?: string; thinking?: string },
	base: {
		timestamp: number;
		adapterId: "claude";
		adapterSessionId: string;
		turnId: string;
	},
): NormalizedEvent[] {
	if (delta.type === "text_delta") {
		return [
			{
				...base,
				kind: "message.delta",
				text: delta.text ?? "",
				role: "assistant" as const,
			},
		];
	}

	if (delta.type === "thinking_delta") {
		return [
			{
				...base,
				kind: "thinking.delta",
				text: delta.thinking ?? "",
				thinkingType: "raw-thinking" as const,
			},
		];
	}

	return [];
}

/** Map the result subtype to a turn completion status. */
function mapResultStatus(
	subtype: unknown,
): "completed" | "interrupted" | "failed" {
	if (subtype === "success") return "completed";
	if (subtype === "interrupted") return "interrupted";
	return "failed";
}

/**
 * Read a numeric field that may appear in camelCase or snake_case.
 * Returns undefined when neither variant is present.
 */
function readNumericField(
	obj: Record<string, unknown>,
	camelKey: string,
	snakeKey: string,
): number | undefined {
	return (
		(obj[camelKey] as number | undefined) ??
		(obj[snakeKey] as number | undefined)
	);
}

export function mapSdkMessage(
	msg: SdkMessage,
	ctx: MapContext,
): NormalizedEvent[] {
	const base = {
		timestamp: Date.now(),
		adapterId: ctx.adapterId,
		adapterSessionId: ctx.adapterSessionId,
		turnId: ctx.turnId,
	};

	switch (msg.type) {
		case "system": {
			if (msg.subtype !== "init") return [];
			return [
				{
					...base,
					kind: "session.started",
					model: msg.model as string,
					tools: (msg.tools as string[]) ?? [],
					providerSessionId:
						(msg.session_id as string) ?? (msg.sessionId as string),
					capabilities: CLAUDE_CAPABILITIES,
				},
			];
		}
		case "system/init": {
			return [
				{
					...base,
					kind: "session.started",
					model: msg.model as string,
					tools: (msg.tools as string[]) ?? [],
					providerSessionId: msg.sessionId as string,
					capabilities: CLAUDE_CAPABILITIES,
				},
			];
		}

		case "stream_event": {
			const event = msg.event as {
				type: string;
				delta?: { type: string; text?: string; thinking?: string };
			};
			if (!event || event.type !== "content_block_delta" || !event.delta)
				return [];
			return mapDelta(event.delta, base);
		}

		case "content_block_delta": {
			const delta = msg.delta as {
				type: string;
				text?: string;
				thinking?: string;
			};
			if (!delta) return [];
			return mapDelta(delta, base);
		}

		case "assistant": {
			return [
				{
					...base,
					kind: "message.final",
					text: extractAssistantText(msg),
					role: "assistant" as const,
					stopReason: extractStopReason(msg),
				},
			];
		}

		case "tool_progress": {
			return [
				{
					...base,
					kind: "tool.progress",
					toolUseId: (msg.tool_use_id as string) ?? (msg.toolUseId as string),
					toolName: (msg.tool_name as string) ?? (msg.toolName as string),
					elapsedSeconds:
						(msg.elapsed_time_seconds as number) ??
						(msg.elapsedSeconds as number),
				},
			];
		}

		case "result": {
			const events: NormalizedEvent[] = [];
			const permissionDenials = Array.isArray(msg.permission_denials)
				? (msg.permission_denials as Array<Record<string, unknown>>)
				: [];

			for (const denial of permissionDenials) {
				const toolUseId =
					(denial.tool_use_id as string | undefined) ??
					(denial.toolUseId as string | undefined);
				const toolName =
					(denial.tool_name as string | undefined) ??
					(denial.toolName as string | undefined);
				if (!toolUseId || !toolName) continue;
				events.push({
					...base,
					kind: "tool.denied",
					toolUseId,
					toolName,
					input:
						denial.tool_input ??
						denial.toolInput ??
						(denial.input as unknown),
				});
			}

			const rawUsage = msg.usage as Record<string, unknown> | undefined;

			if (rawUsage) {
				const inputTokens =
					readNumericField(rawUsage, "inputTokens", "input_tokens") ?? 0;
				const outputTokens =
					readNumericField(rawUsage, "outputTokens", "output_tokens") ?? 0;
				const cacheReadTokens = readNumericField(
					rawUsage,
					"cacheReadInputTokens",
					"cache_read_input_tokens",
				);
				const cacheWriteTokens = readNumericField(
					rawUsage,
					"cacheCreationInputTokens",
					"cache_creation_input_tokens",
				);

				const totalCostUsd =
					(msg.total_cost_usd as number | undefined) ??
					(msg.cost_usd as number | undefined);

				events.push({
					...base,
					kind: "usage.updated",
					inputTokens,
					outputTokens,
					totalCostUsd,
					cacheReadTokens,
					cacheWriteTokens,
					semantics: "session_delta_or_cached" as const,
				});

				events.push({
					...base,
					kind: "turn.completed",
					status: mapResultStatus(msg.subtype),
					durationMs: (msg.duration_ms as number) ?? 0,
					usage: { inputTokens, outputTokens, totalCostUsd },
				});
			} else {
				events.push({
					...base,
					kind: "turn.completed",
					status: mapResultStatus(msg.subtype),
					durationMs: (msg.duration_ms as number) ?? 0,
					usage: undefined,
				});
			}

			return events;
		}

		default:
			return [];
	}
}
