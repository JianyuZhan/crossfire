export interface HistoryEntry {
	role: string;
	summary: string;
	finalText?: string;
}

export function buildStatelessPrompt(
	prompt: string,
	history: HistoryEntry[],
	mode: "summary" = "summary",
): string {
	if (history.length === 0) return prompt;

	const parts: string[] = [];
	parts.push("Previous conversation:");
	for (const entry of history) {
		const content =
			mode === "summary" ? entry.summary : (entry.finalText ?? entry.summary);
		parts.push(`[${entry.role}]: ${content}`);
	}
	parts.push("");
	parts.push(prompt);
	return parts.join("\n");
}
