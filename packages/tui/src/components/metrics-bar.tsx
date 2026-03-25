import { Box, Text } from "ink";
import type React from "react";
import type { MetricsState, ViewportState } from "../state/types.js";

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function formatCost(usd: number | undefined): string {
	if (usd === undefined || usd === 0) return "";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
}

function convergenceBar(percent: number): string {
	const filled = Math.round(percent / 10);
	return `[${"=".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

interface MetricsBarProps {
	state: MetricsState;
	viewport?: ViewportState;
}

/**
 * Returns the constant number of terminal rows this metrics bar occupies.
 */
export function metricsBarHeight(): number {
	return 3;
}

export function MetricsBar({
	state,
	viewport,
}: MetricsBarProps): React.ReactElement {
	const pTokens = formatTokens(state.proposerUsage.tokens);
	const cTokens = formatTokens(state.challengerUsage.tokens);
	const pCost = formatCost(state.proposerUsage.costUsd);
	const cCost = formatCost(state.challengerUsage.costUsd);
	const totalCost = formatCost(state.totalCostUsd);

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor="gray"
			paddingX={1}
		>
			{/* Row 1: Token usage */}
			<Box>
				<Text color="green" bold>
					Proposer{" "}
				</Text>
				<Text dimColor>
					{pTokens} tokens{pCost ? ` (${pCost})` : ""}
				</Text>
				<Text dimColor> {"\u2502"} </Text>
				<Text color="#ffb86c" bold>
					Challenger{" "}
				</Text>
				<Text dimColor>
					{cTokens} tokens{cCost ? ` (${cCost})` : ""}
				</Text>
				{totalCost && (
					<>
						<Text dimColor> {"\u2502"} </Text>
						<Text dimColor>Total: {totalCost}</Text>
					</>
				)}
			</Box>
			{/* Row 2: Convergence + Judge */}
			<Box>
				<Text dimColor>Convergence: </Text>
				<Text
					color={
						state.convergencePercent >= 80
							? "green"
							: state.convergencePercent >= 50
								? "yellow"
								: "white"
					}
					bold
				>
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
			{/* Row 3: Scroll status — highlighted prompts */}
			<Box>
				{viewport ? (
					viewport.autoFollow ? (
						<>
							<Text backgroundColor="green" color="black" bold>
								{" \u25CF LIVE "}
							</Text>
							<Text> </Text>
							<Text backgroundColor="magenta" color="white" bold>
								{" \u2191\u2193 Arrow "}
							</Text>
							<Text color="magenta"> to scroll</Text>
						</>
					) : (
						<>
							<Text backgroundColor="yellow" color="black" bold>
								{" \u25CB SCROLLED "}
							</Text>
							<Text> </Text>
							<Text dimColor>
								L
								{Math.max(
									1,
									viewport.contentHeight -
										viewport.scrollOffset -
										viewport.viewportHeight +
										1,
								)}
								/{viewport.contentHeight}
							</Text>
							<Text> </Text>
							<Text backgroundColor="magenta" color="white" bold>
								{" Ctrl+D "}
							</Text>
							<Text color="magenta"> or </Text>
							<Text backgroundColor="magenta" color="white" bold>
								{" /bottom "}
							</Text>
							<Text color="magenta"> {"\u2192"} resume LIVE</Text>
						</>
					)
				) : (
					<Text dimColor>Ready</Text>
				)}
			</Box>
		</Box>
	);
}
