/** Strip markdown code blocks and labels containing internal tool calls from display text */
export function stripInternalToolBlocks(text: string): string {
  return (
    text
      // Complete fenced blocks: ```debate_meta ... ```
      .replace(/```(?:debate_meta|judge_verdict)\s*[\s\S]*?```\s*/g, "")
      // Incomplete trailing fenced block (streaming — closing ``` hasn't arrived yet)
      .replace(/```(?:debate_meta|judge_verdict)[\s\S]*$/g, "")
      // Bare label followed by JSON (no backtick fencing, e.g. Codex output)
      .replace(/\n?(?:debate_meta|judge_verdict)\s*\n\s*\{[\s\S]*?\}\s*$/g, "")
      // Markdown-bold labels like **debate_meta 结构化总结：** or **debate_meta summary:**
      .replace(
        /\n?\*{0,2}(?:debate_meta|judge_verdict)[^*\n]*\*{0,2}\s*[:：]?\s*\n?/gi,
        "",
      )
      .trim()
  );
}
