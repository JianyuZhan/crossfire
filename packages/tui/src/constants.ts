export const STATUS_ICONS: Record<string, string> = {
	idle: "\u25CB", // ○
	thinking: "\u25D0", // ◐
	tool: "\u2699", // ⚙
	speaking: "\u25C9", // ◉
	done: "\u2713", // ✓
	error: "\u2717", // ✗
};

export const ROLE_COLORS: Record<string, string> = {
	proposer: "green",
	challenger: "red",
};

export function roleLabel(role: string): string {
	return role === "proposer" ? "Proposer" : "Challenger";
}

export function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}
