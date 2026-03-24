import type { NormalizedEvent } from "@crossfire/adapter-core";
import { GEMINI_CAPABILITIES } from "@crossfire/adapter-core";

export interface GeminiMapContext {
	adapterId: "gemini";
	adapterSessionId: string;
	turnId: string;
	sessionStarted: boolean;
	messageBuffer: string;
}

interface GeminiEvent {
	type: string;
	[key: string]: unknown;
}

export function mapGeminiEvent(
	event: GeminiEvent,
	ctx: GeminiMapContext,
): NormalizedEvent[] {
	const base = {
		timestamp: Date.now(),
		adapterId: ctx.adapterId,
		adapterSessionId: ctx.adapterSessionId,
		turnId: ctx.turnId,
	};

	switch (event.type) {
		case "init": {
			if (ctx.sessionStarted) return [];
			ctx.sessionStarted = true;
			return [
				{
					timestamp: base.timestamp,
					adapterId: ctx.adapterId,
					adapterSessionId: ctx.adapterSessionId,
					kind: "session.started",
					model: (event.model as string) ?? "unknown",
					tools: (event.tools as string[]) ?? [],
					providerSessionId: event.session_id as string,
					capabilities: GEMINI_CAPABILITIES,
				},
			];
		}

		case "message": {
			const text = event.text as string;
			if (!text) return [];
			ctx.messageBuffer += text;
			return [
				{
					...base,
					kind: "message.delta",
					text,
					role: "assistant" as const,
				},
			];
		}

		case "thought": {
			return [
				{
					...base,
					kind: "thinking.delta",
					text: event.text as string,
					thinkingType: "raw-thinking" as const,
				},
			];
		}

		case "tool_use": {
			return [
				{
					...base,
					kind: "tool.call",
					toolUseId: event.tool_use_id as string,
					toolName: event.name as string,
					input: event.input,
				},
			];
		}

		case "tool_result": {
			return [
				{
					...base,
					kind: "tool.result",
					toolUseId: event.tool_use_id as string,
					toolName: (event.name as string) ?? "unknown",
					success: (event.success as boolean) ?? true,
					output: event.output,
				},
			];
		}

		case "error": {
			const fatal = event.fatal as boolean;
			if (fatal) {
				return [
					{
						...base,
						kind: "run.error",
						message: event.message as string,
						recoverable: false,
					},
				];
			}
			return [
				{
					...base,
					kind: "run.warning",
					message: event.message as string,
				},
			];
		}

		case "result": {
			const events: NormalizedEvent[] = [];
			// Flush message buffer as message.final
			if (ctx.messageBuffer) {
				events.push({
					...base,
					kind: "message.final",
					text: ctx.messageBuffer,
					role: "assistant" as const,
				});
				ctx.messageBuffer = "";
			}
			// Usage
			const usage = event.usage as
				| { input_tokens: number; output_tokens: number }
				| undefined;
			if (usage) {
				events.push({
					...base,
					kind: "usage.updated",
					inputTokens: usage.input_tokens,
					outputTokens: usage.output_tokens,
				});
			}
			// Turn completed
			events.push({
				...base,
				kind: "turn.completed",
				status: "completed",
				durationMs: (event.duration_ms as number) ?? 0,
				usage: usage
					? {
							inputTokens: usage.input_tokens,
							outputTokens: usage.output_tokens,
						}
					: undefined,
			});
			return events;
		}

		default:
			return [];
	}
}
