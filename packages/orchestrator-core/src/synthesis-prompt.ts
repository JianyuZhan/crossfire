import type { DebateState } from "./types.js";

export interface SynthesisPromptConfig {
	contextTokenLimit: number;
}

export interface JudgeNote {
	roundNumber: number;
	leading: "proposer" | "challenger" | "tie";
	reasoning: string;
}

/**
 * Conservative token estimation: always Math.ceil(text.length * 0.5)
 */
export function estimateTokens(text: string): number {
	if (text.length === 0) return 0;
	return Math.ceil(text.length * 0.5);
}

/**
 * Detects if text is majority CJK (>30% of chars in CJK Unicode ranges)
 * CJK ranges: U+4E00-U+9FFF (CJK Unified Ideographs), U+3400-U+4DBF (CJK Extension A)
 */
export function detectCjkMajority(text: string): boolean {
	if (text.length === 0) return false;

	let cjkCount = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.codePointAt(i);
		if (code === undefined) continue;

		// CJK Unified Ideographs: U+4E00-U+9FFF
		// CJK Extension A: U+3400-U+4DBF
		if (
			(code >= 0x4e00 && code <= 0x9fff) ||
			(code >= 0x3400 && code <= 0x4dbf)
		) {
			cjkCount++;
		}

		// Skip next char if this is a surrogate pair
		if (code > 0xffff) {
			i++;
		}
	}

	return cjkCount / text.length > 0.3;
}

/**
 * Builds a full-text synthesis prompt from debate state, judge notes, and optional round summaries.
 * If the full prompt exceeds 60% of contextTokenLimit, it truncates early rounds while preserving:
 * - Last 2 rounds
 * - All judge verdicts
 * - 3rd-to-last round if it fits
 */
export function buildFullTextSynthesisPrompt(
	state: DebateState,
	judgeNotes: JudgeNote[],
	config: SynthesisPromptConfig,
	roundSummaries?: string[],
): string {
	const isCjk = detectCjkMajority(state.config.topic);

	// Build instructions
	const instructions = isCjk
		? buildInstructionsChinese()
		: buildInstructionsEnglish();

	// Build full prompt with all content
	const fullPrompt = buildPromptContent(
		state,
		judgeNotes,
		instructions,
		roundSummaries,
	);

	// Check token budget
	const estimatedTokens = estimateTokens(fullPrompt);
	const tokenBudget = config.contextTokenLimit * 0.6;

	if (estimatedTokens <= tokenBudget) {
		return fullPrompt;
	}

	// Over budget: truncate early rounds
	return buildTruncatedPrompt(
		state,
		judgeNotes,
		instructions,
		config,
		roundSummaries,
	);
}

function buildInstructionsEnglish(): string {
	return `# Synthesis Task

You are synthesizing a comprehensive action plan from a structured adversarial debate.

Your goal is to produce a deeply actionable, well-organized report that captures:
- Areas of consensus and concrete action items
- Points of divergence and their underlying reasoning
- Key risks, dependencies, and open questions
- Clear next steps with owners and success criteria

## Recommended Structure

1. **Executive Summary** — high-level overview of the debate outcome and key decisions
2. **Consensus Action Items** — concrete steps both sides agree on, with priority and ownership
3. **Divergent Perspectives** — significant disagreements, why they matter, and options for resolution
4. **Risk Assessment** — potential blockers, dependencies, and mitigation strategies
5. **Open Questions** — unresolved issues that need further investigation
6. **Success Criteria** — measurable outcomes to validate the plan
7. **Next Steps** — immediate actions with timeline and DRI (Directly Responsible Individual)

## Quality Standards

- **Depth over breadth**: go deep on the most critical issues
- **Actionability**: every recommendation should be concrete and testable
- **Completeness**: address all major points raised, even if briefly
- **Balance**: fairly represent both sides' strongest arguments
- **Clarity**: use clear language, avoid jargon unless necessary

Now, here is the debate transcript and judge feedback:
`;
}

function buildInstructionsChinese(): string {
	return `# 综合任务

你正在从结构化对抗式辩论中综合一个全面的行动计划。

你的目标是生成一份深度可操作、组织良好的报告，包含：
- 共识领域和具体行动项
- 分歧点及其背后的推理
- 关键风险、依赖关系和未决问题
- 明确的后续步骤，包括负责人和成功标准

## 推荐结构

1. **执行摘要** — 辩论结果和关键决策的高层概述
2. **共识行动项** — 双方同意的具体步骤，包括优先级和负责人
3. **分歧视角** — 重大分歧、其重要性以及解决方案选项
4. **风险评估** — 潜在阻碍因素、依赖关系和缓解策略
5. **未决问题** — 需要进一步调查的未解决事项
6. **成功标准** — 验证计划的可衡量成果
7. **后续步骤** — 带有时间线和直接责任人(DRI)的即时行动

## 质量标准

- **深度优于广度**：深入探讨最关键的议题
- **可操作性**：每个建议都应具体且可测试
- **完整性**：涉及所有主要观点，即使简要提及
- **平衡性**：公平代表双方最有力的论点
- **清晰性**：使用清晰语言，除非必要避免行话

现在，这是辩论记录和评审反馈：
`;
}

function buildPromptContent(
	state: DebateState,
	judgeNotes: JudgeNote[],
	instructions: string,
	roundSummaries?: string[],
): string {
	let content = instructions;
	content += "\n\n";

	// Add topic
	content += `## Topic\n\n${state.config.topic}\n\n`;

	// Add round summaries if provided
	if (roundSummaries && roundSummaries.length > 0) {
		content += "## Round Summaries\n\n";
		for (const summary of roundSummaries) {
			content += `${summary}\n\n`;
		}
	}

	// Group turns by round
	const turnsByRound = new Map<number, typeof state.turns>();
	for (const turn of state.turns) {
		if (!turnsByRound.has(turn.roundNumber)) {
			turnsByRound.set(turn.roundNumber, []);
		}
		turnsByRound.get(turn.roundNumber)?.push(turn);
	}

	// Add debate transcript
	content += "## Debate Transcript\n\n";
	const sortedRounds = Array.from(turnsByRound.keys()).sort((a, b) => a - b);

	for (const roundNum of sortedRounds) {
		const turns = turnsByRound.get(roundNum) || [];
		content += `### Round ${roundNum}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			content += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				content += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}
	}

	// Add judge verdicts
	if (judgeNotes.length > 0) {
		content += "## Judge Verdicts\n\n";
		for (const note of judgeNotes) {
			content += `**Round ${note.roundNumber}** (Leading: ${note.leading}):\n\n`;
			content += `${note.reasoning}\n\n`;
		}
	}

	return content;
}

function buildTruncatedPrompt(
	state: DebateState,
	judgeNotes: JudgeNote[],
	instructions: string,
	config: SynthesisPromptConfig,
	roundSummaries?: string[],
): string {
	// Group turns by round
	const turnsByRound = new Map<number, typeof state.turns>();
	for (const turn of state.turns) {
		if (!turnsByRound.has(turn.roundNumber)) {
			turnsByRound.set(turn.roundNumber, []);
		}
		turnsByRound.get(turn.roundNumber)?.push(turn);
	}

	const sortedRounds = Array.from(turnsByRound.keys()).sort((a, b) => a - b);

	// Always include last 2 rounds
	const lastTwoRounds = sortedRounds.slice(-2);
	const thirdToLastRound =
		sortedRounds.length >= 3 ? sortedRounds[sortedRounds.length - 3] : null;

	// Build fixed components (always included)
	let fixedContent = instructions;
	fixedContent += "\n\n";
	fixedContent += `## Topic\n\n${state.config.topic}\n\n`;

	// Add round summaries if provided
	if (roundSummaries && roundSummaries.length > 0) {
		fixedContent += "## Round Summaries\n\n";
		for (const summary of roundSummaries) {
			fixedContent += `${summary}\n\n`;
		}
	}

	// Add last 2 rounds
	fixedContent += "## Debate Transcript (Last 2 Rounds)\n\n";
	for (const roundNum of lastTwoRounds) {
		const turns = turnsByRound.get(roundNum) || [];
		fixedContent += `### Round ${roundNum}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			fixedContent += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				fixedContent += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}
	}

	// Add judge verdicts (always include all)
	if (judgeNotes.length > 0) {
		fixedContent += "## Judge Verdicts\n\n";
		for (const note of judgeNotes) {
			fixedContent += `**Round ${note.roundNumber}** (Leading: ${note.leading}):\n\n`;
			fixedContent += `${note.reasoning}\n\n`;
		}
	}

	const fixedTokens = estimateTokens(fixedContent);
	const tokenBudget = config.contextTokenLimit * 0.6;
	const remainingBudget = tokenBudget - fixedTokens;

	// Try to add 3rd-to-last round if it fits
	if (thirdToLastRound !== null && remainingBudget > 0) {
		const turns = turnsByRound.get(thirdToLastRound) || [];
		let thirdRoundContent = `### Round ${thirdToLastRound}\n\n`;

		for (const turn of turns) {
			const roleLabel = turn.role === "proposer" ? "Proposer" : "Challenger";
			thirdRoundContent += `**${roleLabel}:**\n\n${turn.content}\n\n`;

			if (turn.meta) {
				thirdRoundContent += `*Stance: ${turn.meta.stance}, Confidence: ${turn.meta.confidence}*\n\n`;
			}
		}

		const thirdRoundTokens = estimateTokens(thirdRoundContent);
		if (thirdRoundTokens <= remainingBudget) {
			// Insert before last 2 rounds
			const transcriptStart = fixedContent.indexOf(
				"## Debate Transcript (Last 2 Rounds)",
			);
			const lastRoundsStart = fixedContent.indexOf(
				"### Round",
				transcriptStart,
			);
			fixedContent =
				fixedContent.slice(0, lastRoundsStart) +
				thirdRoundContent +
				fixedContent.slice(lastRoundsStart);
		}
	}

	// Add note about truncation for earlier rounds
	if (sortedRounds.length > 3) {
		const truncatedCount = sortedRounds.length - 3;
		const noteText = detectCjkMajority(state.config.topic)
			? `\n*注意：为节省上下文空间，省略了前 ${truncatedCount} 轮的详细内容。*\n\n`
			: `\n*Note: ${truncatedCount} earlier rounds omitted for brevity. Focus on the most recent rounds and judge verdicts above.*\n\n`;

		const transcriptStart = fixedContent.indexOf("## Debate Transcript");
		const headerEnd = fixedContent.indexOf("\n\n", transcriptStart) + 2;
		fixedContent =
			fixedContent.slice(0, headerEnd) +
			noteText +
			fixedContent.slice(headerEnd);
	}

	return fixedContent;
}
