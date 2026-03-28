import { stripInternalToolBlocks } from "../state/strip-internal.js";
import type {
	AgentTurnSnapshot,
	LiveAgentPanelState,
	LiveToolEntry,
	RenderBlock,
} from "../state/types.js";

type AgentRole = "proposer" | "challenger";

const TOOL_STATUS_MAP: Record<string, "running" | "success" | "error"> = {
	running: "running",
	done: "success",
	error: "error",
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
			status: "done",
			duration: snap.turnDurationMs,
		},
	];
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
			status: state.status,
			duration: state.turnDurationMs,
		},
	];
	if (state.status === "thinking" && state.thinkingText) {
		blocks.push({ kind: "thinking", text: state.thinkingText });
	}
	for (const t of state.tools) blocks.push(toolToBlock(t));
	for (const w of state.warnings) blocks.push({ kind: "warning", text: w });
	if (state.error) blocks.push({ kind: "error", text: state.error });
	const displayText = stripInternalToolBlocks(state.currentMessageText);
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
