import { Box, Text } from "ink";
import type React from "react";
import {
	ROLE_COLORS,
	STATUS_ICONS,
	formatDuration,
	roleLabel,
} from "../constants.js";
import {
	buildToolActivityLabel,
	selectVisibleLiveTools,
	summarizeDeniedTools,
	summarizeRecentFailures,
	summarizeUnknownOutcomes,
} from "../render/tool-status.js";
import { stripInternalToolBlocks } from "../state/strip-internal.js";
import type {
	AgentTurnSnapshot,
	LiveAgentPanelState,
	LiveToolEntry,
	PlanStep,
	SubagentEntry,
} from "../state/types.js";

type AgentRole = "proposer" | "challenger";

interface LivePanelProps {
	mode: "live";
	role: AgentRole;
	agentType?: string;
	state: LiveAgentPanelState;
}

interface SnapshotPanelProps {
	mode: "snapshot";
	role: AgentRole;
	agentType?: string;
	snapshot: AgentTurnSnapshot;
}

interface IdlePanelProps {
	mode: "idle";
	role: AgentRole;
	agentType?: string;
}

export type AgentPanelProps =
	| LivePanelProps
	| SnapshotPanelProps
	| IdlePanelProps;

function agentSuffix(agentType?: string): string {
	return agentType ? ` [${agentType}]` : "";
}

function statusText(state: LiveAgentPanelState): string {
	const modeSuffix = state.executionMode ? ` [${state.executionMode}]` : "";
	switch (state.status) {
		case "idle":
			return `Idle${modeSuffix}`;
		case "thinking":
			return `Thinking...${modeSuffix}`;
		case "tool":
			if (state.tools.length === 0) return `Tool${modeSuffix}`;
			return `Tool: ${state.tools[state.tools.length - 1].toolName} ${buildToolActivityLabel(state.tools).replace(/^tool /, "")}${modeSuffix}`;
		case "speaking":
			return `Responding...${modeSuffix}`;
		case "done":
			return state.turnDurationMs !== undefined
				? `Done (${formatDuration(state.turnDurationMs)})${modeSuffix}`
				: `Done${modeSuffix}`;
		case "error":
			return `Error${modeSuffix}`;
	}
}

const TOOL_STATUS_ICONS: Record<string, string> = {
	requested: "…",
	running: "▶",
	succeeded: "✓",
	failed: "✗",
	denied: "⊘",
	unknown: "?",
};

function ToolList({ tools }: { tools: LiveToolEntry[] }): React.ReactElement {
	return (
		<>
			{tools.map((tool) => (
				<Box key={tool.toolUseId}>
					<Text dimColor>
						{TOOL_STATUS_ICONS[tool.status] ?? "✗"} {tool.toolName}
						{tool.expanded ? ` (${tool.inputSummary})` : ""}
						{tool.elapsedMs !== undefined
							? ` ${formatDuration(tool.elapsedMs)}`
							: ""}
						{["failed", "denied", "unknown"].includes(tool.status) &&
						tool.resultSummary
							? ` — ${tool.resultSummary}`
							: ""}
					</Text>
				</Box>
			))}
		</>
	);
}

function PlanList({ steps }: { steps: PlanStep[] }): React.ReactElement {
	return (
		<>
			<Text dimColor bold>
				Plan
			</Text>
			{steps.map((step) => (
				<Box key={step.id}>
					<Text dimColor>
						{step.status === "completed"
							? "[x]"
							: step.status === "in_progress"
								? "[>]"
								: step.status === "failed"
									? "[!]"
									: "[ ]"}{" "}
						{step.title}
					</Text>
				</Box>
			))}
		</>
	);
}

function SubagentList({
	subagents,
}: {
	subagents: SubagentEntry[];
}): React.ReactElement {
	return (
		<>
			{subagents.map((subagent) => (
				<Box key={subagent.subagentId}>
					<Text dimColor>
						{subagent.status === "completed" ? "Subagent ✓" : "Subagent ▶"}{" "}
						{subagent.description ?? subagent.subagentId}
					</Text>
				</Box>
			))}
		</>
	);
}

export function AgentPanel(props: AgentPanelProps): React.ReactElement {
	const label = roleLabel(props.role);
	const color = ROLE_COLORS[props.role] ?? "white";
	const agent = agentSuffix(props.agentType);

	if (props.mode === "idle") {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Text bold color={color}>
					{label}
					<Text dimColor>{agent}</Text>
				</Text>
				<Text dimColor>Waiting...</Text>
			</Box>
		);
	}

	if (props.mode === "snapshot") {
		const { snapshot } = props;
		const duration = snapshot.turnDurationMs
			? ` (${formatDuration(snapshot.turnDurationMs)})`
			: "";
		const modeLabel = snapshot.executionMode
			? ` [${snapshot.executionMode}]`
			: "";
		return (
			<Box flexDirection="column" paddingX={1}>
				<Box>
					<Text bold color={color}>
						{label}
						<Text dimColor>{agent}</Text>
					</Text>
					<Text dimColor>
						{duration}
						{modeLabel}
					</Text>
				</Box>
				{snapshot.tools.length > 0 && <ToolList tools={snapshot.tools} />}
				{snapshot.error && (
					<Text color="red" bold>
						Error: {snapshot.error}
					</Text>
				)}
				{snapshot.thinkingText && (
					<Box marginTop={1}>
						<Text dimColor italic>
							{snapshot.thinkingType === "reasoning-summary"
								? `Reasoning: ${snapshot.thinkingText}`
								: snapshot.thinkingText}
						</Text>
					</Box>
				)}
				{snapshot.narrationTexts?.map((text, i) => (
					<Box key={`${text}-${i}`} marginTop={1}>
						<Text>{text}</Text>
					</Box>
				))}
				{snapshot.latestPlan && snapshot.latestPlan.length > 0 && (
					<Box marginTop={1} flexDirection="column">
						<PlanList steps={snapshot.latestPlan} />
					</Box>
				)}
				{snapshot.subagents && snapshot.subagents.length > 0 && (
					<Box marginTop={1} flexDirection="column">
						<SubagentList subagents={snapshot.subagents} />
					</Box>
				)}
				{snapshot.warnings.map((w, i) => (
					<Text key={`${w}-${i}`} color="yellow">
						⚠ {w}
					</Text>
				))}
				{snapshot.messageText && (
					<Box marginTop={1}>
						<Text>{snapshot.messageText}</Text>
					</Box>
				)}
			</Box>
		);
	}

	// Live mode
	const { state } = props;
	const displayText = stripInternalToolBlocks(state.currentMessageText);

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box>
				<Text bold color={color}>
					{STATUS_ICONS[state.status] ?? "○"} {label}
					<Text dimColor>{agent}</Text>
				</Text>
				<Text> </Text>
				<Text color={state.status === "error" ? "red" : "cyan"}>
					{statusText(state)}
				</Text>
			</Box>
			{state.error && (
				<Box marginTop={1}>
					<Text color="red" bold>
						Error: {state.error}
					</Text>
				</Box>
			)}
			{state.warnings.map((w, i) => (
				<Text key={`${w}-${i}`} color="yellow">
					⚠ {w}
				</Text>
			))}
			{state.thinkingText && (
				<Box marginTop={1}>
					<Text dimColor italic>
						{state.thinkingType === "reasoning-summary"
							? `Reasoning: ${state.thinkingText}`
							: state.thinkingText}
					</Text>
				</Box>
			)}
			{state.narrationTexts.map((text, i) => (
				<Box key={`${text}-${i}`} marginTop={1}>
					<Text>{text}</Text>
				</Box>
			))}
			{state.latestPlan && state.latestPlan.length > 0 && (
				<Box marginTop={1} flexDirection="column">
					<PlanList steps={state.latestPlan} />
				</Box>
			)}
			{state.subagents && state.subagents.length > 0 && (
				<Box marginTop={1} flexDirection="column">
					<SubagentList subagents={state.subagents} />
				</Box>
			)}
			{(() => {
				const failureSummary = summarizeRecentFailures(state.tools);
				return failureSummary ? (
					<Box marginTop={1}>
						<Text color="yellow">
							⚠ {(state.tools.find((tool) => tool.status === "failed")?.toolName ?? "Tool")} failures:{" "}
							{failureSummary.replace(/^recent failures: /, "")}
						</Text>
					</Box>
				) : null;
			})()}
			{(() => {
				const deniedSummary = summarizeDeniedTools(state.tools);
				return deniedSummary ? (
					<Box marginTop={1}>
						<Text color="yellow">⚠ {deniedSummary}</Text>
					</Box>
				) : null;
			})()}
			{(() => {
				const unknownSummary = summarizeUnknownOutcomes(state.tools);
				return unknownSummary ? (
					<Box marginTop={1}>
						<Text color="yellow">⚠ {unknownSummary}</Text>
					</Box>
				) : null;
			})()}
			<ToolList tools={selectVisibleLiveTools(state.tools)} />
			{(state.status === "speaking" || state.status === "done") &&
				displayText && (
					<Box marginTop={1}>
						<Text>{displayText}</Text>
					</Box>
				)}
		</Box>
	);
}
