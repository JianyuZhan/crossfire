import type { NormalizedEvent } from "@crossfire/adapter-core";
import { CLAUDE_CAPABILITIES } from "@crossfire/adapter-core";

interface MapContext {
	adapterId: "claude";
	adapterSessionId: string;
	turnId: string;
}

import type { SdkMessage } from "./types.js";

/**
 * Extract text content from an assistant message.
 *
 * The SDK sends `{ type: 'assistant', message: APIAssistantMessage }` where
 * `message.content` is an array of content blocks. We also handle the
 * simplified format `{ type: 'assistant', content: string }` used in tests.
 */
function extractAssistantText(msg: SdkMessage): string {
	// Real SDK format: msg.message is an APIAssistantMessage
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
	// Test/simplified format: content is a top-level string
	if (typeof msg.content === "string") return msg.content;
	return "";
}

/**
 * Extract stop reason from an assistant message.
 */
function extractStopReason(msg: SdkMessage): string | undefined {
	const apiMsg = msg.message as { stop_reason?: string } | undefined;
	if (apiMsg?.stop_reason) return apiMsg.stop_reason;
	return msg.stopReason as string | undefined;
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
		// Real SDK: { type: 'system', subtype: 'init', session_id, model, tools, ... }
		// Test compat: { type: 'system/init', sessionId, model, tools }
		case "system": {
			if (msg.subtype !== "init") return [];
			return [
				{
					timestamp: base.timestamp,
					adapterId: ctx.adapterId,
					adapterSessionId: ctx.adapterSessionId,
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
			// Legacy/test format
			return [
				{
					timestamp: base.timestamp,
					adapterId: ctx.adapterId,
					adapterSessionId: ctx.adapterSessionId,
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

			if (event.delta.type === "text_delta") {
				return [
					{
						...base,
						kind: "message.delta",
						text: event.delta.text ?? "",
						role: "assistant" as const,
					},
				];
			}

			if (event.delta.type === "thinking_delta") {
				return [
					{
						...base,
						kind: "thinking.delta",
						text: event.delta.thinking ?? "",
						thinkingType: "raw-thinking" as const,
					},
				];
			}

			return [];
		}

		// Raw API streaming events (SDK may yield these directly without stream_event wrapper)
		case "content_block_delta": {
			const delta = msg.delta as {
				type: string;
				text?: string;
				thinking?: string;
			};
			if (!delta) return [];

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
			// Real SDK: usage has camelCase (inputTokens, outputTokens)
			// Test compat: usage has snake_case (input_tokens, output_tokens)
			const rawUsage = msg.usage as Record<string, unknown> | undefined;
			const events: NormalizedEvent[] = [];

			let inputTokens = 0;
			let outputTokens = 0;
			let hasUsage = false;

			if (rawUsage) {
				hasUsage = true;
				inputTokens =
					(rawUsage.inputTokens as number) ??
					(rawUsage.input_tokens as number) ??
					0;
				outputTokens =
					(rawUsage.outputTokens as number) ??
					(rawUsage.output_tokens as number) ??
					0;
			}

			const totalCostUsd =
				(msg.total_cost_usd as number | undefined) ??
				(msg.cost_usd as number | undefined);

			if (hasUsage) {
				events.push({
					...base,
					kind: "usage.updated",
					inputTokens,
					outputTokens,
					totalCostUsd,
				});
			}

			const status =
				msg.subtype === "success"
					? "completed"
					: msg.subtype === "interrupted"
						? "interrupted"
						: "failed";
			events.push({
				...base,
				kind: "turn.completed",
				status,
				durationMs: (msg.duration_ms as number) ?? 0,
				usage: hasUsage
					? { inputTokens, outputTokens, totalCostUsd }
					: undefined,
			});

			return events;
		}

		default:
			return [];
	}
}
