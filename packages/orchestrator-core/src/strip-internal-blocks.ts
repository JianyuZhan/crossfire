/** Required keys that identify debate_meta JSON */
const DEBATE_META_KEYS = ["stance", "confidence", "key_points"];
/** Required keys that identify judge_verdict JSON (need at least 3 of 4) */
const JUDGE_VERDICT_KEYS = ["leading", "score", "reasoning", "should_continue"];

/**
 * Detect whether a JSON-ish string block is internal meta/verdict data.
 * Uses JSON.parse with key-presence check — order-independent and robust.
 * Falls back to regex key detection for incomplete/malformed JSON (streaming).
 */
function isInternalJson(block: string): boolean {
	try {
		const obj = JSON.parse(block.trim());
		if (typeof obj !== "object" || obj === null) return false;
		const keys = Object.keys(obj);
		const isDebateMeta = DEBATE_META_KEYS.every((k) => keys.includes(k));
		const isJudgeVerdict =
			JUDGE_VERDICT_KEYS.filter((k) => keys.includes(k)).length >= 3;
		return isDebateMeta || isJudgeVerdict;
	} catch {
		// Fallback for incomplete JSON (streaming): check key presence via regex
		// More lenient thresholds since JSON may be truncated mid-stream
		const metaKeyHits = DEBATE_META_KEYS.filter((k) =>
			new RegExp(`["']${k}["']\\s*:`).test(block),
		).length;
		const verdictKeyHits = JUDGE_VERDICT_KEYS.filter((k) =>
			new RegExp(`["']${k}["']\\s*:`).test(block),
		).length;
		return metaKeyHits >= 2 || verdictKeyHits >= 3;
	}
}

/** Strip internal meta-tool blocks from text for human-readable output */
export function stripInternalBlocks(text: string): string {
	return (
		text
			// Explicit fence: ```debate_meta or ```judge_verdict (complete)
			.replace(/```(?:debate_meta|judge_verdict)\s*[\s\S]*?```\s*/g, "")
			// Explicit fence: incomplete trailing block
			.replace(/```(?:debate_meta|judge_verdict)[\s\S]*$/g, "")
			// ```json fence with internal signature fields (complete)
			.replace(/```json\s*([\s\S]*?)```\s*/g, (match, body) =>
				isInternalJson(body) ? "" : match,
			)
			// ```json fence: incomplete trailing block with internal signature fields
			.replace(/```json\s*([\s\S]*)$/g, (match, body) =>
				isInternalJson(body) ? "" : match,
			)
			// Bare label followed by JSON (no backtick fencing)
			.replace(/\n?(?:debate_meta|judge_verdict)\s*\n\s*\{[\s\S]*?\}\s*$/g, "")
			.trim()
	);
}
