import { stripInternalBlocks } from "@crossfire/orchestrator-core";
import type {
	AgentTurnSnapshot,
	LiveAgentPanelState,
	LiveToolEntry,
	RenderBlock,
} from "../state/types.js";
import {
	buildToolActivityLabel,
	selectVisibleLiveTools,
	summarizeDeniedTools,
	summarizeRecentFailures,
	summarizeUnknownOutcomes,
} from "./tool-status.js";

type AgentRole = "proposer" | "challenger";

const TOOL_STATUS_MAP: Record<string, "running" | "success" | "error"> = {
	requested: "running",
	running: "running",
	succeeded: "success",
	failed: "error",
	denied: "error",
	unknown: "error",
};

function toolToBlock(t: LiveToolEntry): RenderBlock {
	return {
		kind: "tool-call",
		toolName: t.toolName,
		status: TOOL_STATUS_MAP[t.status] ?? "error",
		summary: t.inputSummary,
		elapsedMs: t.elapsedMs,
	};
}

function buildLiveStatusLabel(state: LiveAgentPanelState): string | undefined {
	if (state.status !== "tool") return undefined;
	return buildToolActivityLabel(state.tools);
}

export function snapshotToBlocks(
	snap: AgentTurnSnapshot,
	role: AgentRole,
	agentType?: string,
): RenderBlock[] {
	const blocks: RenderBlock[] = [
		{
			kind: "agent-header",
			role,
			agentType,
			preset: snap.preset,
			status: "done",
			duration: snap.turnDurationMs,
		},
	];
	if (snap.thinkingText) {
		blocks.push({
			kind: "thinking",
			text: snap.thinkingText,
			thinkingType: snap.thinkingType,
		});
	}
	for (const narration of snap.narrationTexts ?? []) {
		if (!narration) continue;
		blocks.push({ kind: "message", text: narration, isFinal: false });
	}
	if (snap.latestPlan?.length) {
		blocks.push({ kind: "plan", steps: snap.latestPlan });
	}
	for (const subagent of snap.subagents ?? []) {
		blocks.push({
			kind: "subagent",
			description: subagent.description ?? subagent.subagentId,
			status: subagent.status,
		});
	}
	for (const t of snap.tools) blocks.push(toolToBlock(t));
	for (const w of snap.warnings) blocks.push({ kind: "warning", text: w });
	if (snap.error) blocks.push({ kind: "error", text: snap.error });
	if (snap.messageText)
		blocks.push({ kind: "message", text: snap.messageText, isFinal: true });
	return blocks;
}

export function liveStateToBlocks(state: LiveAgentPanelState): RenderBlock[] {
	const blocks: RenderBlock[] = [
		{
			kind: "agent-header",
			role: state.role,
			agentType: state.agentType,
			preset: state.preset,
			status: state.status,
			statusLabel: buildLiveStatusLabel(state),
			duration: state.turnDurationMs,
		},
	];
	if (state.thinkingText) {
		blocks.push({
			kind: "thinking",
			text: state.thinkingText,
			thinkingType: state.thinkingType,
		});
	}
	for (const narration of state.narrationTexts) {
		if (!narration) continue;
		blocks.push({ kind: "message", text: narration, isFinal: false });
	}
	if (state.latestPlan?.length) {
		blocks.push({ kind: "plan", steps: state.latestPlan });
	}
	for (const subagent of state.subagents ?? []) {
		blocks.push({
			kind: "subagent",
			description: subagent.description ?? subagent.subagentId,
			status: subagent.status,
		});
	}
	const failureSummary = summarizeRecentFailures(state.tools);
	if (failureSummary) {
		const toolName = state.tools.find(
			(tool) => tool.status === "failed",
		)?.toolName;
		blocks.push({
			kind: "warning",
			text: toolName
				? `${toolName} failures: ${failureSummary.replace(/^recent failures: /, "")}`
				: failureSummary,
		});
	}
	const deniedSummary = summarizeDeniedTools(state.tools);
	if (deniedSummary) {
		blocks.push({ kind: "warning", text: deniedSummary });
	}
	const unknownSummary = summarizeUnknownOutcomes(state.tools);
	if (unknownSummary) {
		blocks.push({ kind: "warning", text: unknownSummary });
	}
	for (const t of selectVisibleLiveTools(state.tools))
		blocks.push(toolToBlock(t));
	for (const w of state.warnings) blocks.push({ kind: "warning", text: w });
	if (state.error) blocks.push({ kind: "error", text: state.error });
	const displayText = stripInternalBlocks(state.currentMessageText);
	if (displayText && (state.status === "speaking" || state.status === "done")) {
		blocks.push({
			kind: "message",
			text: displayText,
			isFinal: state.status === "done",
		});
	}
	return blocks;
}

export function idleBlocks(role: AgentRole, agentType?: string): RenderBlock[] {
	return [{ kind: "agent-header", role, agentType, status: "idle" }];
}
