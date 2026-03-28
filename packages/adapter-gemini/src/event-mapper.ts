import {
	GEMINI_CAPABILITIES,
	type NormalizedEvent,
} from "@crossfire/adapter-core";

export interface GeminiMapContext {
	adapterId: "gemini";
	adapterSessionId: string;
	turnId: string;
	sessionStarted: boolean;
	messageBuffer: string;
	toolNamesById: Record<string, string>;
}

interface GeminiEvent {
	type: string;
	[key: string]: unknown;
}

function readMessageText(event: GeminiEvent): string {
	return String(event.content ?? event.text ?? "");
}

function readToolUseId(event: GeminiEvent): string {
	return String(event.tool_id ?? event.tool_use_id ?? "");
}

function readToolName(event: GeminiEvent, ctx: GeminiMapContext): string {
	const toolUseId = readToolUseId(event);
	return String(
		event.tool_name ??
			event.name ??
			(toolUseId ? ctx.toolNamesById[toolUseId] : undefined) ??
			"unknown",
	);
}

function readToolInput(event: GeminiEvent): unknown {
	return event.parameters ?? event.input;
}

export function mapGeminiEvent(
	event: GeminiEvent,
	ctx: GeminiMapContext,
): NormalizedEvent[] {
	const now = Date.now();
	const sessionBase = {
		timestamp: now,
		adapterId: ctx.adapterId,
		adapterSessionId: ctx.adapterSessionId,
	};
	const base = { ...sessionBase, turnId: ctx.turnId };

	switch (event.type) {
		case "init": {
			if (ctx.sessionStarted) return [];
			ctx.sessionStarted = true;
			return [
				{
					...sessionBase,
					kind: "session.started",
					model: (event.model as string) ?? "unknown",
					tools: (event.tools as string[]) ?? [],
					providerSessionId: event.session_id as string,
					capabilities: GEMINI_CAPABILITIES,
				},
			];
		}

		case "message": {
			if (event.role && event.role !== "assistant") return [];
			const text = readMessageText(event);
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
			const toolUseId = readToolUseId(event);
			const toolName = readToolName(event, ctx);
			if (toolUseId && toolName !== "unknown") {
				ctx.toolNamesById[toolUseId] = toolName;
			}
			return [
				{
					...base,
					kind: "tool.call",
					toolUseId,
					toolName,
					input: readToolInput(event),
				},
			];
		}

		case "tool_result": {
			const toolUseId = readToolUseId(event);
			return [
				{
					...base,
					kind: "tool.result",
					toolUseId,
					toolName: readToolName(event, ctx),
					success:
						(event.success as boolean | undefined) ??
						event.status === "success",
					output: event.output,
				},
			];
		}

		case "error": {
			if (event.fatal) {
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
			if (ctx.messageBuffer) {
				events.push({
					...base,
					kind: "message.final",
					text: ctx.messageBuffer,
					role: "assistant" as const,
				});
				ctx.messageBuffer = "";
			}
			const rawUsage =
				(event.usage as
					| { input_tokens: number; output_tokens: number }
					| undefined) ??
				(event.stats as
					| { input_tokens: number; output_tokens: number }
					| undefined);
			const normalizedUsage = rawUsage
				? {
						inputTokens: rawUsage.input_tokens,
						outputTokens: rawUsage.output_tokens,
					}
				: undefined;
			if (normalizedUsage) {
				events.push({
					...base,
					kind: "usage.updated",
					...normalizedUsage,
				});
			}
			events.push({
				...base,
				kind: "turn.completed",
				status: "completed",
				durationMs:
					(event.duration_ms as number | undefined) ??
					(event.stats as { duration_ms?: number } | undefined)?.duration_ms ??
					0,
				usage: normalizedUsage,
			});
			return events;
		}

		default:
			return [];
	}
}
