import type {
	AuditReport,
	DraftReport,
	RoundAnalysis,
} from "@crossfire/orchestrator-core";

// --- Config ---

export interface SynthesizerConfig {
	apiKey?: string;
	model?: string;
	timeoutMs: number;
	flushTimeoutMs: number;
	enabled: boolean;
}

// --- Prompt builders (pure) ---

export interface RoundSynthesisInput {
	roundNumber: number;
	proposerText: string;
	challengerText: string;
	previousRoundSummary?: string;
	planSnapshot: { consensus: string[]; unresolved: string[] };
}

export function buildRoundSynthesisPrompt(input: RoundSynthesisInput): string {
	const sections: string[] = [];

	sections.push(
		`You are an analytical assistant reviewing Round ${input.roundNumber} of a structured debate.`,
	);

	if (input.previousRoundSummary) {
		sections.push(`Previous context:\n${input.previousRoundSummary}`);
	}

	sections.push(
		`Current consensus: ${input.planSnapshot.consensus.join(", ") || "none yet"}`,
	);
	sections.push(
		`Current unresolved: ${input.planSnapshot.unresolved.join(", ") || "none yet"}`,
	);

	sections.push(`Proposer's argument:\n${input.proposerText}`);
	sections.push(`Challenger's argument:\n${input.challengerText}`);

	sections.push(`Analyze this round and output a JSON object inside a \`\`\`json fenced block with this structure:
{
  "roundNumber": ${input.roundNumber},
  "newArguments": [{"side": "proposer"|"challenger", "argument": "...", "strength": "strong"|"moderate"|"weak"}],
  "challengedArguments": [{"argument": "...", "challengedBy": "...", "outcome": "held"|"weakened"|"conceded"}],
  "risksIdentified": [{"risk": "...", "severity": "low"|"medium"|"high", "raisedBy": "..."}],
  "evidenceCited": [{"claim": "...", "source": "...", "side": "..."}],
  "newConsensus": ["..."],
  "newDivergence": ["..."],
  "roundSummary": "One paragraph summary of this round"
}`);

	return sections.join("\n\n");
}

export function buildFinalSynthesisPrompt(draft: DraftReport): string {
	const sections: string[] = [];

	sections.push(
		"You are a synthesis assistant producing the final audit report for a structured debate.",
	);

	sections.push(
		`Consensus items (${draft.consensus.length}):\n${draft.consensus.map((c) => `- ${c.title}`).join("\n") || "none"}`,
	);
	sections.push(
		`Unresolved items (${draft.unresolved.length}):\n${draft.unresolved.map((u) => `- ${u.title}`).join("\n") || "none"}`,
	);

	if (draft.argumentTrajectories.length > 0) {
		sections.push(
			`Argument trajectories:\n${draft.argumentTrajectories.map((t) => `- ${t.text} [${t.side}] → ${t.finalStatus}`).join("\n")}`,
		);
	}

	if (draft.risks.length > 0) {
		sections.push(
			`Risks identified:\n${draft.risks.map((r) => `- ${r.risk} (${r.severity})`).join("\n")}`,
		);
	}

	if (draft.evidence.length > 0) {
		sections.push(
			`Evidence cited:\n${draft.evidence.map((e) => `- ${e.claim}: ${e.source}`).join("\n")}`,
		);
	}

	if (draft.judgeNotes.length > 0) {
		sections.push(
			`Judge notes:\n${draft.judgeNotes.map((j) => `- R${j.roundNumber}: ${j.leading} leading — ${j.reasoning}`).join("\n")}`,
		);
	}

	sections.push(`Output a JSON object inside a \`\`\`json fenced block matching the AuditReport schema:
{
  "executiveSummary": "...",
  "consensusItems": [{"title": "...", "detail": "...", "nextSteps": "...", "supportingEvidence": ["..."]}],
  "unresolvedIssues": [{"title": "...", "proposerPosition": "...", "challengerPosition": "...", "risk": "...", "suggestedExploration": "..."}],
  "argumentEvolution": [{"argument": "...", "trajectory": "...", "finalStatus": "..."}],
  "riskMatrix": [{"risk": "...", "severity": "...", "likelihood": "...", "mitigation": "..."}],
  "evidenceRegistry": [{"claim": "...", "source": "...", "usedBy": "...", "contested": true|false}]
}`);

	return sections.join("\n\n");
}

// --- Parsers (pure) ---

function extractJson(text: string): unknown | undefined {
	const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
	if (!match) {
		// Try parsing the whole text as JSON
		try {
			return JSON.parse(text.trim());
		} catch {
			return undefined;
		}
	}
	try {
		return JSON.parse(match[1].trim());
	} catch {
		return undefined;
	}
}

export function parseRoundAnalysisResponse(
	text: string,
	roundNumber: number,
): RoundAnalysis | undefined {
	const parsed = extractJson(text);
	if (!parsed || typeof parsed !== "object") return undefined;

	const obj = parsed as Record<string, unknown>;
	// Minimal validation
	if (!Array.isArray(obj.newArguments)) return undefined;

	return {
		roundNumber:
			typeof obj.roundNumber === "number" ? obj.roundNumber : roundNumber,
		newArguments: obj.newArguments as RoundAnalysis["newArguments"],
		challengedArguments: (obj.challengedArguments ??
			[]) as RoundAnalysis["challengedArguments"],
		risksIdentified: (obj.risksIdentified ??
			[]) as RoundAnalysis["risksIdentified"],
		evidenceCited: (obj.evidenceCited ?? []) as RoundAnalysis["evidenceCited"],
		newConsensus: (obj.newConsensus ?? []) as string[],
		newDivergence: (obj.newDivergence ?? []) as string[],
		roundSummary: (obj.roundSummary ?? `Round ${roundNumber}`) as string,
	};
}

export function parseFinalSynthesisResponse(
	text: string,
): AuditReport | undefined {
	const parsed = extractJson(text);
	if (!parsed || typeof parsed !== "object") return undefined;

	const obj = parsed as Record<string, unknown>;
	if (typeof obj.executiveSummary !== "string") return undefined;

	return {
		executiveSummary: obj.executiveSummary,
		consensusItems: (obj.consensusItems ?? []) as AuditReport["consensusItems"],
		unresolvedIssues: (obj.unresolvedIssues ??
			[]) as AuditReport["unresolvedIssues"],
		argumentEvolution: (obj.argumentEvolution ??
			[]) as AuditReport["argumentEvolution"],
		riskMatrix: (obj.riskMatrix ?? []) as AuditReport["riskMatrix"],
		evidenceRegistry: (obj.evidenceRegistry ??
			[]) as AuditReport["evidenceRegistry"],
	};
}

// --- LLM caller (effectful) ---

export async function callSynthesizerLLM(
	prompt: string,
	config: SynthesizerConfig,
): Promise<string | undefined> {
	if (!config.enabled || !config.apiKey) return undefined;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": config.apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: config.model ?? "claude-sonnet-4-20250514",
				max_tokens: 4096,
				messages: [{ role: "user", content: prompt }],
			}),
			signal: controller.signal,
		});

		if (!response.ok) return undefined;

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};

		const textBlock = data.content?.find((b) => b.type === "text");
		return textBlock?.text;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}
