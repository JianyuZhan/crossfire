import type { LocalTurnMetrics } from "./types.js";

/**
 * Measures local prompt metrics at the adapter boundary.
 *
 * @param semanticText - The core semantic prompt content (user's topic, opponent's message, etc.)
 * @param overheadText - Adapter-specific overhead (system prompts, meta-tool instructions, formatting)
 * @returns LocalTurnMetrics with character and byte counts split by semantic vs overhead
 */
export function measureLocalMetrics(
	semanticText: string,
	overheadText = "",
): LocalTurnMetrics {
	const encoder = new TextEncoder();
	const semanticBytes = encoder.encode(semanticText).length;
	const overheadBytes = encoder.encode(overheadText).length;

	return {
		semanticChars: semanticText.length,
		semanticUtf8Bytes: semanticBytes,
		adapterOverheadChars: overheadText.length,
		adapterOverheadUtf8Bytes: overheadBytes,
		totalChars: semanticText.length + overheadText.length,
		totalUtf8Bytes: semanticBytes + overheadBytes,
	};
}
