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

export function summarizeRecentFailures(
	tools: LiveToolEntry[],
): string | undefined {
	const recentErrors = tools
		.filter((tool) => tool.status === "failed")
		.slice(-RECENT_FAILURE_LIMIT);
	if (recentErrors.length === 0) return undefined;

	const counts = new Map<string, number>();
	for (const tool of recentErrors) {
		const key = normalizeFailureLabel(tool.resultSummary);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const parts = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, FAILURE_GROUP_LIMIT)
		.map(([label, count]) => `${label}×${count}`);
	return parts.length > 0 ? `recent failures: ${parts.join(", ")}` : undefined;
}

export function summarizeDeniedTools(
	tools: LiveToolEntry[],
): string | undefined {
	const deniedTools = tools.filter((tool) => tool.status === "denied");
	if (deniedTools.length === 0) return undefined;

	const counts = new Map<string, number>();
	for (const tool of deniedTools) {
		counts.set(tool.toolName, (counts.get(tool.toolName) ?? 0) + 1);
	}

	const parts = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, FAILURE_GROUP_LIMIT)
		.map(([label, count]) => `${label}×${count}`);
	return parts.length > 0 ? `denied: ${parts.join(", ")}` : undefined;
}

export function summarizeUnknownOutcomes(
	tools: LiveToolEntry[],
): string | undefined {
	const unknownTools = tools.filter((tool) => tool.status === "unknown");
	if (unknownTools.length === 0) return undefined;

	const counts = new Map<string, number>();
	for (const tool of unknownTools) {
		counts.set(tool.toolName, (counts.get(tool.toolName) ?? 0) + 1);
	}

	const parts = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, FAILURE_GROUP_LIMIT)
		.map(([label, count]) => `${label}×${count}`);
	return parts.length > 0 ? `unknown outcomes: ${parts.join(", ")}` : undefined;
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
	if (!["thinking", "tool", "speaking", "error"].includes(panel.status)) {
		return undefined;
	}
	const presetSuffix = panel.preset ? ` [${panel.preset}]` : "";
	if (panel.status === "tool") {
		return `${roleLabel(panel.role)} ${buildToolActivityLabel(panel.tools)}${presetSuffix}`;
	}
	if (panel.status === "thinking") {
		return `${roleLabel(panel.role)} thinking${presetSuffix}`;
	}
	if (panel.status === "speaking") {
		return `${roleLabel(panel.role)} responding${presetSuffix}`;
	}
	return `${roleLabel(panel.role)} error${presetSuffix}`;
}
