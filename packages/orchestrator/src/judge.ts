import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
} from "@crossfire/adapter-core";
import {
	JudgeVerdictSchema,
	extractFencedJson,
} from "@crossfire/orchestrator-core";
import type { AnyEvent, JudgeVerdict } from "@crossfire/orchestrator-core";
import type { DebateEventBus } from "./event-bus.js";

export interface JudgeTurnInput {
	turnId: string;
	prompt: string;
	roundNumber: number;
}

/**
 * Extract any JSON object from text that looks like a judge verdict.
 * Tries multiple strategies: ```json blocks, bare JSON objects, prose parsing.
 */
function extractVerdictJson(text: string): unknown | undefined {
	// Try ```json fenced blocks
	const jsonBlocks = text.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g);
	for (const m of jsonBlocks) {
		try {
			const obj = JSON.parse(m[1].trim());
			if (
				obj &&
				typeof obj === "object" &&
				"leading" in obj &&
				"score" in obj
			) {
				return obj;
			}
		} catch {
			/* skip malformed */
		}
	}
	// Try bare JSON objects containing verdict fields
	const braceMatches = text.matchAll(
		/\{[^{}]*"leading"\s*:[^{}]*"score"\s*:[^{}]*\}/g,
	);
	for (const m of braceMatches) {
		try {
			return JSON.parse(m[0]);
		} catch {
			/* skip malformed */
		}
	}
	// Fallback: extract verdict from prose/markdown format
	return extractVerdictFromProse(text);
}

/**
 * Fallback: extract judge verdict from prose/markdown output.
 * Handles patterns like:
 *   领先方：挑战者（Challenger）  or  Leading: challenger
 *   提案者：7.0/10 挑战者：7.8/10  or  Proposer: 7/10
 *   应继续辩论：是  or  should_continue: true
 *   评估理由：...  or  reasoning after verdict block
 */
function extractVerdictFromProse(text: string): unknown | undefined {
	// Detect leading side
	let leading: string | undefined;
	// Chinese patterns
	const leadCn = text.match(
		/领先[方者]\s*[:：]\s*(?:\*{0,2})(提案者|挑战者|平局|proposer|challenger|tie)/i,
	);
	if (leadCn) {
		const raw = leadCn[1].toLowerCase();
		if (raw === "提案者" || raw === "proposer") leading = "proposer";
		else if (raw === "挑战者" || raw === "challenger") leading = "challenger";
		else leading = "tie";
	}
	// English patterns
	if (!leading) {
		const leadEn = text.match(
			/leading\s*[:：]\s*(?:\*{0,2})(proposer|challenger|tie)/i,
		);
		if (leadEn) leading = leadEn[1].toLowerCase();
	}
	if (!leading) return undefined;

	// Extract scores
	let proposerScore = 0;
	let challengerScore = 0;
	// Pattern: 提案者：7.0/10 or Proposer: 7/10
	const pScoreMatch = text.match(
		/(?:提案者|proposer)\s*[:：]\s*([\d.]+)\s*(?:\/\s*10)?/i,
	);
	const cScoreMatch = text.match(
		/(?:挑战者|challenger)\s*[:：]\s*([\d.]+)\s*(?:\/\s*10)?/i,
	);
	if (pScoreMatch) proposerScore = Number.parseFloat(pScoreMatch[1]);
	if (cScoreMatch) challengerScore = Number.parseFloat(cScoreMatch[1]);

	// Extract reasoning
	let reasoning = "";
	const reasonMatch = text.match(
		/(?:评估理由|评估原因|reasoning|理由)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*\n?\s*([\s\S]*?)(?=\n\s*\*{0,2}(?:应继续|should_continue)|$)/i,
	);
	if (reasonMatch) {
		reasoning = reasonMatch[1]
			.replace(/^\*{1,2}\s*/, "")
			.trim()
			.slice(0, 500);
	}
	if (!reasoning) {
		// Grab text between score section and should_continue
		const afterScore = text.match(
			/(?:\d+\s*\/\s*10[)\s]*)\n+([\s\S]*?)(?=\*{0,2}(?:应继续|should)|$)/i,
		);
		if (afterScore) reasoning = afterScore[1].trim().slice(0, 500);
	}

	// Extract should_continue
	let shouldContinue = true;
	const scCn = text.match(/应继续辩论\s*[:：]\s*(是|否|yes|no|true|false)/i);
	const scEn = text.match(/should_continue\s*[:：]\s*(true|false|yes|no)/i);
	const scMatch = scCn || scEn;
	if (scMatch) {
		const val = scMatch[1].toLowerCase();
		shouldContinue = val === "是" || val === "yes" || val === "true";
	}

	return {
		leading,
		score: { proposer: proposerScore, challenger: challengerScore },
		reasoning: reasoning || `${leading} is leading based on judge evaluation.`,
		should_continue: shouldContinue,
	};
}

function parseVerdict(data: unknown): JudgeVerdict | undefined {
	const parsed = JudgeVerdictSchema.safeParse(data);
	if (!parsed.success) return undefined;
	return {
		leading: parsed.data.leading,
		score: parsed.data.score,
		reasoning: parsed.data.reasoning,
		shouldContinue: parsed.data.should_continue,
		repetitionScore: parsed.data.repetition_score,
		clarificationResponse: parsed.data.clarification_response,
	};
}

export async function runJudgeTurn(
	adapter: AgentAdapter,
	handle: SessionHandle,
	bus: DebateEventBus,
	input: JudgeTurnInput,
): Promise<JudgeVerdict | undefined> {
	let verdict: JudgeVerdict | undefined;

	// Listen for judge_verdict via tool.call OR fenced code block in message.final
	const unsub = bus.subscribe((event: AnyEvent) => {
		if (
			event.kind === "tool.call" &&
			"toolName" in event &&
			(event as NormalizedEvent & { toolName: string }).toolName ===
				"judge_verdict"
		) {
			const toolEvent = event as NormalizedEvent & { input: unknown };
			const v = parseVerdict(toolEvent.input);
			if (v) verdict = v;
		}

		// Also extract from fenced code blocks in message.final
		if (
			event.kind === "message.final" &&
			"turnId" in event &&
			(event as NormalizedEvent).turnId === input.turnId
		) {
			if (!verdict) {
				const text = (event as { text: string }).text;
				// Try labeled ```judge_verdict block first
				let json = extractFencedJson(text, "judge_verdict");
				if (json) {
					const v = parseVerdict(json);
					if (v) verdict = v;
				}
				// Fallback: try ```json blocks or bare JSON with verdict fields
				if (!verdict) {
					json = extractVerdictJson(text);
					if (json) {
						const v = parseVerdict(json);
						if (v) verdict = v;
					}
				}
			}
		}
	});

	// Send the turn and wait for completion
	await adapter.sendTurn(handle, {
		turnId: input.turnId,
		prompt: input.prompt,
	});

	// Wait for turn.completed
	await new Promise<void>((resolve) => {
		const turnUnsub = bus.subscribe((event: AnyEvent) => {
			if (
				event.kind === "turn.completed" &&
				"turnId" in event &&
				(event as NormalizedEvent).turnId === input.turnId
			) {
				turnUnsub();
				resolve();
			}
		});
	});

	unsub();
	return verdict;
}
