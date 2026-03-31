import { Box, Text } from "ink";
import type React from "react";
import { buildCompactActiveStatus } from "../render/tool-status.js";
import type {
	LiveAgentPanelState,
	AgentUsage,
	MetricsState,
	ViewportState,
} from "../state/types.js";

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function formatCost(usd: number | undefined): string {
	if (usd === undefined || usd === 0) return "";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
}

function formatUsageSemantics(usage: AgentUsage): string | undefined {
	switch (usage.semantics) {
		case "cumulative_thread_total":
			return "thread cumulative";
		case "session_delta_or_cached":
			return "session delta";
		case "per_turn":
			return "per turn";
		case "unknown":
			return "provider specific";
		default:
			return undefined;
	}
}

function convergenceColor(percent: number): string {
	if (percent >= 80) return "green";
	if (percent >= 50) return "yellow";
	return "white";
}

function convergenceBar(percent: number): string {
	const filled = Math.round(percent / 10);
	return `[${"=".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

interface MetricsBarProps {
	state: MetricsState;
	viewport?: ViewportState;
	livePanels?: {
		proposer: LiveAgentPanelState;
		challenger: LiveAgentPanelState;
	};
}

/**
 * Returns the constant number of terminal rows this metrics bar occupies.
 */
export function metricsBarHeight(): number {
	return 4;
}

function ScrollStatus({
	viewport,
}: { viewport?: ViewportState }): string {
	if (!viewport) {
		return "Ready";
	}

	if (viewport.autoFollow) {
		return "\u25CF LIVE  \u2191\u2193 Arrow to scroll";
	}

	const currentLine = Math.max(
		1,
		viewport.contentHeight -
			viewport.scrollOffset -
			viewport.viewportHeight +
			1,
	);

	return `\u25CB SCROLLED  L${currentLine}/${viewport.contentHeight}  Ctrl+D or /bottom \u2192 resume LIVE`;
}

function activeStatusSummary(
	livePanels?: MetricsBarProps["livePanels"],
): string | undefined {
	if (!livePanels) return undefined;
	return (
		buildCompactActiveStatus(livePanels.proposer) ??
		buildCompactActiveStatus(livePanels.challenger)
	);
}

export function MetricsBar({
	state,
	viewport,
	livePanels,
}: MetricsBarProps): React.ReactElement {
	const pTokens = formatTokens(state.proposerUsage.tokens);
	const cTokens = formatTokens(state.challengerUsage.tokens);
	const pCost = formatCost(state.proposerUsage.costUsd);
	const cCost = formatCost(state.challengerUsage.costUsd);
	const pSemantics = formatUsageSemantics(state.proposerUsage);
	const cSemantics = formatUsageSemantics(state.challengerUsage);
	const totalCost = formatCost(state.totalCostUsd);
	const scrollSummary = ScrollStatus({ viewport });
	const activeSummary = activeStatusSummary(livePanels);

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor="gray"
			paddingX={1}
		>
			{/* Row 1: Active status */}
			<Box>
				<Text wrap="truncate">
					{activeSummary ? `Active: ${activeSummary}` : "Active: idle"}
				</Text>
			</Box>
			{/* Row 2: Token usage */}
			<Box>
				<Text color="green" bold>
					Proposer{" "}
				</Text>
				<Text dimColor>
					{pTokens} tokens{pSemantics ? ` (${pSemantics})` : ""}
					{pCost ? ` ${pCost}` : ""}
				</Text>
				<Text dimColor> {"\u2502"} </Text>
				<Text color="#ffb86c" bold>
					Challenger{" "}
				</Text>
				<Text dimColor>
					{cTokens} tokens{cSemantics ? ` (${cSemantics})` : ""}
					{cCost ? ` ${cCost}` : ""}
				</Text>
				{totalCost && (
					<>
						<Text dimColor> {"\u2502"} </Text>
						<Text dimColor>Total: {totalCost}</Text>
					</>
				)}
			</Box>
			{/* Row 3: Convergence + Judge */}
			<Box>
				<Text dimColor>Convergence: </Text>
				<Text color={convergenceColor(state.convergencePercent)} bold>
					{convergenceBar(state.convergencePercent)} {state.convergencePercent}%
				</Text>
				{state.judgeVerdict && (
					<>
						<Text dimColor> {"\u2502"} </Text>
						<Text color="yellow" bold>
							Judge:{" "}
						</Text>
						<Text color={state.judgeVerdict.shouldContinue ? "cyan" : "red"}>
							{state.judgeVerdict.shouldContinue ? "Continue" : "End"}
						</Text>
						{state.judgeVerdict.leading &&
							state.judgeVerdict.leading !== "tie" && (
								<Text dimColor> ({state.judgeVerdict.leading} leads)</Text>
							)}
					</>
				)}
			</Box>
			{/* Row 4: Scroll status */}
			<Box>
				<Text wrap="truncate">{scrollSummary}</Text>
			</Box>
		</Box>
	);
}
