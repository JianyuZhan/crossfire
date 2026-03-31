import type {
	AgentAdapter,
	MessageDeltaEvent,
	MessageFinalEvent,
	NormalizedEvent,
	SessionHandle,
	TurnCompletedEvent,
} from "@crossfire/adapter-core";
import type { AdapterFactoryMap } from "../wiring/create-adapters.js";
import {
	type PromptTemplateFamily,
	inferPromptTemplateFamily,
} from "./prompt-template.js";
import { resolveAdapterType } from "./resolver.js";
import type { ProfileConfig } from "./schema.js";

export const DEFAULT_TEMPLATE_CLASSIFIER_TIMEOUT_MS = 20_000;
const TEMPLATE_CLASSIFIER_TURN_ID = "template-classifier";

const TEMPLATE_CLASSIFIER_SYSTEM_PROMPT = `You classify debate topics for Crossfire prompt templates.

Choose exactly one family:
- "general": business, product, strategy, market, research, operations, policy, organization, or non-code planning topics
- "code": repositories, implementation, debugging, testing, refactoring, architecture review, pull requests, code changes, build/lint/CI, or file-level technical work

Return strict JSON only:
{"family":"general"|"code","confidence":0.0-1.0,"reason":"short explanation"}

Do not use tools. Do not add markdown fences.`;

export interface PromptTemplateClassification {
	family: PromptTemplateFamily;
	confidence: number;
	reason: string;
	source: "llm" | "fallback";
}

export interface ClassifyPromptTemplateFamilyInput {
	topic: string;
	profile: ProfileConfig;
	model?: string;
	factories: AdapterFactoryMap;
	timeoutMs?: number;
	workingDirectory?: string;
}

interface ParsedClassifierPayload {
	family: PromptTemplateFamily;
	confidence: number;
	reason: string;
}

export async function classifyPromptTemplateFamily(
	input: ClassifyPromptTemplateFamilyInput,
): Promise<PromptTemplateClassification> {
	const fallback = buildFallbackClassification(input.topic);
	const adapter = input.factories[resolveAdapterType(input.profile.agent)]();
	let session: SessionHandle | undefined;
	const finalTexts: string[] = [];
	const deltaTexts: string[] = [];

	try {
		const completion = createTurnCompletionWaiter(
			adapter,
			TEMPLATE_CLASSIFIER_TURN_ID,
			finalTexts,
			deltaTexts,
		);
		session = await adapter.startSession({
			profile: input.profile.name,
			workingDirectory: input.workingDirectory ?? process.cwd(),
			model: input.model ?? input.profile.model,
			mcpServers: input.profile.mcp_servers,
			providerOptions: {
				systemPrompt: TEMPLATE_CLASSIFIER_SYSTEM_PROMPT,
			},
		});
		await adapter.sendTurn(session, {
			turnId: TEMPLATE_CLASSIFIER_TURN_ID,
			prompt: buildClassifierPrompt(input.topic),
			executionMode: "plan",
			timeout: input.timeoutMs ?? DEFAULT_TEMPLATE_CLASSIFIER_TIMEOUT_MS,
		});
		const completed = await waitForTurnCompletion(
			completion.promise,
			input.timeoutMs ?? DEFAULT_TEMPLATE_CLASSIFIER_TIMEOUT_MS,
		);
		if (completed.status !== "completed") {
			return fallback;
		}

		const rawOutput = buildClassifierOutput(finalTexts, deltaTexts);
		const parsed = parseClassifierOutput(rawOutput);
		if (!parsed) return fallback;
		return {
			family: parsed.family,
			confidence: parsed.confidence,
			reason: parsed.reason,
			source: "llm",
		};
	} catch {
		return fallback;
	} finally {
		if (session) {
			await adapter.close(session).catch(() => undefined);
		}
	}
}

export function parseClassifierOutput(
	output: string,
): ParsedClassifierPayload | undefined {
	const trimmed = stripMarkdownFences(output).trim();
	const jsonCandidate = extractFirstJsonObject(trimmed);
	if (!jsonCandidate) return undefined;
	try {
		const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
		const family = parsed.family;
		const confidence = parsed.confidence;
		const reason = parsed.reason;
		if (family !== "general" && family !== "code") return undefined;
		if (typeof confidence !== "number" || Number.isNaN(confidence)) {
			return undefined;
		}
		if (typeof reason !== "string" || reason.trim().length === 0) {
			return undefined;
		}
		return {
			family,
			confidence: Math.max(0, Math.min(1, confidence)),
			reason: reason.trim(),
		};
	} catch {
		return undefined;
	}
}

function buildClassifierPrompt(topic: string): string {
	return [
		"Classify this debate topic into the best prompt-template family.",
		"",
		`Topic: ${topic}`,
		"",
		'Return strict JSON only with keys "family", "confidence", and "reason".',
	].join("\n");
}

function buildFallbackClassification(
	topic: string,
): PromptTemplateClassification {
	const family = inferPromptTemplateFamily(topic);
	return {
		family,
		confidence: 0.25,
		reason:
			"Fallback heuristic used because the template classifier did not return valid JSON in time.",
		source: "fallback",
	};
}

function buildClassifierOutput(
	finalTexts: string[],
	deltaTexts: string[],
): string {
	const finalOutput = finalTexts.join("\n").trim();
	if (finalOutput.length > 0) return finalOutput;
	return deltaTexts.join("").trim();
}

function stripMarkdownFences(text: string): string {
	if (!text.startsWith("```")) return text;
	return text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
}

function extractFirstJsonObject(text: string): string | undefined {
	const start = text.indexOf("{");
	if (start < 0) return undefined;
	let depth = 0;
	for (let i = start; i < text.length; i += 1) {
		const char = text[i];
		if (char === "{") depth += 1;
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

function createTurnCompletionWaiter(
	adapter: AgentAdapter,
	turnId: string,
	finalTexts: string[],
	deltaTexts: string[],
): {
	promise: Promise<TurnCompletedEvent>;
} {
	let resolveCompletion: ((event: TurnCompletedEvent) => void) | undefined;
	const promise = new Promise<TurnCompletedEvent>((resolve) => {
		resolveCompletion = resolve;
	});
	const unsubscribe = adapter.onEvent((event: NormalizedEvent) => {
		if (event.turnId !== turnId) return;
		if (event.kind === "message.final") {
			finalTexts.push((event as MessageFinalEvent).text);
			return;
		}
		if (event.kind === "message.delta") {
			deltaTexts.push((event as MessageDeltaEvent).text);
			return;
		}
		if (event.kind === "turn.completed") {
			unsubscribe();
			resolveCompletion?.(event as TurnCompletedEvent);
		}
	});
	return { promise };
}

async function waitForTurnCompletion(
	promise: Promise<TurnCompletedEvent>,
	timeoutMs: number,
): Promise<TurnCompletedEvent> {
	return await Promise.race([
		promise,
		new Promise<TurnCompletedEvent>((_, reject) => {
			setTimeout(
				() => reject(new Error("template classifier timeout")),
				timeoutMs,
			);
		}),
	]);
}
