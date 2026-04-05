import { formatDuration, roleLabel } from "../constants.js";
import type { LiveAgentPanelState, LiveToolEntry } from "../state/types.js";

const RECENT_FAILURE_LIMIT = 8;
const FAILURE_GROUP_LIMIT = 3;

function normalizeFailureLabel(summary?: string): string {
	if (!summary) return "error";
	const statusMatch = summary.match(/status code (\d+)/i);
	if (statusMatch) return statusMatch[1];
	const blockedMatch = summary.match(/unable to fetch from ([^ ]+)/i);
	if (blockedMatch) return `blocked ${blockedMatch[1]}`;
	if (summary === "Command failed with no output") return "no output";
	if (summary.startsWith("sizeCalculation")) return "invalid page size";
	return summary.length <= 40 ? summary : `${summary.slice(0, 39)}…`;
}

/**
 * Count-and-format helper shared by all tool summary functions.
 * Filters tools by status, groups by keyFn, and formats as "prefix: key1xN, key2xM".
 */
function summarizeByStatus(
	tools: LiveToolEntry[],
	status: LiveToolEntry["status"],
	prefix: string,
	keyFn: (tool: LiveToolEntry) => string,
	limit?: number,
): string | undefined {
	const filtered = tools.filter((tool) => tool.status === status);
	const sliced = limit !== undefined ? filtered.slice(-limit) : filtered;
	if (sliced.length === 0) return undefined;

	const counts = new Map<string, number>();
	for (const tool of sliced) {
		const key = keyFn(tool);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const parts = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, FAILURE_GROUP_LIMIT)
		.map(([label, count]) => `${label}×${count}`);
	return parts.length > 0 ? `${prefix}: ${parts.join(", ")}` : undefined;
}

export function summarizeRecentFailures(
	tools: LiveToolEntry[],
): string | undefined {
	return summarizeByStatus(
		tools,
		"failed",
		"recent failures",
		(tool) => normalizeFailureLabel(tool.resultSummary),
		RECENT_FAILURE_LIMIT,
	);
}

export function summarizeDeniedTools(
	tools: LiveToolEntry[],
): string | undefined {
	return summarizeByStatus(tools, "denied", "denied", (tool) => tool.toolName);
}

export function summarizeUnknownOutcomes(
	tools: LiveToolEntry[],
): string | undefined {
	return summarizeByStatus(
		tools,
		"unknown",
		"unknown outcomes",
		(tool) => tool.toolName,
	);
}

/**
 * Build warning messages for tool failures, denials, and unknown outcomes.
 * Shared between the Ink AgentPanel and the line-buffer renderer.
 */
export function buildToolWarnings(tools: LiveToolEntry[]): string[] {
	const warnings: string[] = [];
	const fail = summarizeRecentFailures(tools);
	if (fail) {
		const name = tools.find((t) => t.status === "failed")?.toolName;
		warnings.push(
			name
				? `${name} failures: ${fail.replace(/^recent failures: /, "")}`
				: fail,
		);
	}
	const denied = summarizeDeniedTools(tools);
	if (denied) warnings.push(denied);
	const unknown = summarizeUnknownOutcomes(tools);
	if (unknown) warnings.push(unknown);
	return warnings;
}

export function selectVisibleLiveTools(
	tools: LiveToolEntry[],
): LiveToolEntry[] {
	return tools.filter(
		(tool) => tool.status === "requested" || tool.status === "running",
	);
}

export function buildToolActivityLabel(tools: LiveToolEntry[]): string {
	const requested = tools.filter((tool) => tool.status === "requested").length;
	const running = tools.filter((tool) => tool.status === "running").length;
	const longestRunningMs = tools.reduce<number | undefined>(
		(maxElapsed, tool) => {
			if (
				(tool.status !== "requested" && tool.status !== "running") ||
				tool.elapsedMs === undefined
			) {
				return maxElapsed;
			}
			return maxElapsed === undefined
				? tool.elapsedMs
				: Math.max(maxElapsed, tool.elapsedMs);
		},
		undefined,
	);
	const parts: string[] = [];
	if (requested > 0) parts.push(`${requested} requested`);
	if (running > 0) parts.push(`${running} running`);
	if (longestRunningMs !== undefined) {
		parts.push(`active ${formatDuration(longestRunningMs)}`);
	}
	const failureSummary = summarizeRecentFailures(tools);
	if (failureSummary) parts.push(failureSummary);
	const deniedSummary = summarizeDeniedTools(tools);
	if (deniedSummary) parts.push(deniedSummary);
	const unknownSummary = summarizeUnknownOutcomes(tools);
	if (unknownSummary) parts.push(unknownSummary);
	return parts.length > 0 ? `tool (${parts.join(", ")})` : "tool";
}

export function buildCompactActiveStatus(
	panel: LiveAgentPanelState,
): string | undefined {
	const presetSuffix = panel.preset ? ` [${panel.preset}]` : "";
	const label = roleLabel(panel.role);
	switch (panel.status) {
		case "thinking":
			return `${label} thinking${presetSuffix}`;
		case "tool":
			return `${label} ${buildToolActivityLabel(panel.tools)}${presetSuffix}`;
		case "speaking":
			return `${label} responding${presetSuffix}`;
		case "error":
			return `${label} error${presetSuffix}`;
		default:
			return undefined;
	}
}
