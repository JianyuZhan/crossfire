export interface HistoryEntry {
	role: string;
	summary: string;
	finalText?: string;
}

export function buildStatelessPrompt(
	prompt: string,
	history: HistoryEntry[],
): string {
	if (history.length === 0) return prompt;

	const parts: string[] = [
		"Previous conversation:",
		...history.map((entry) => `[${entry.role}]: ${entry.summary}`),
		"",
		prompt,
	];
	return parts.join("\n");
}
