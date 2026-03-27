/** Strip internal meta-tool blocks from text for human-readable output */
export function stripInternalBlocks(text: string): string {
	return text
		.replace(/```(?:debate_meta|judge_verdict)\s*[\s\S]*?```\s*/g, "")
		.replace(/```(?:debate_meta|judge_verdict)[\s\S]*$/g, "")
		.replace(/\n?(?:debate_meta|judge_verdict)\s*\n\s*\{[\s\S]*?\}\s*$/g, "")
		.trim();
}
