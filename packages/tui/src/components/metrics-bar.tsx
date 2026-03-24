import { Box, Text } from "ink";
import type React from "react";
import type { MetricsState } from "../state/types.js";

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function convergenceBar(percent: number): string {
	const filled = Math.round(percent / 10);
	return "[" + "=".repeat(filled) + "-".repeat(10 - filled) + "]";
}

interface MetricsBarProps {
	state: MetricsState;
}

export function MetricsBar({ state }: MetricsBarProps): React.ReactElement {
	const pTokens = formatTokens(state.proposerUsage.tokens);
	const cTokens = formatTokens(state.challengerUsage.tokens);

	return (
		<Box paddingX={1}>
			<Text color="green" bold>
				Proposer{" "}
			</Text>
			<Text dimColor>{pTokens} tokens</Text>
			<Text dimColor> | </Text>
			<Text color="red" bold>
				Challenger{" "}
			</Text>
			<Text dimColor>{cTokens} tokens</Text>
			<Text dimColor> | </Text>
			<Text dimColor>
				Convergence: {convergenceBar(state.convergencePercent)}{" "}
				{state.convergencePercent}%
			</Text>
			{state.judgeScore && (
				<>
					<Text dimColor> | </Text>
					<Text dimColor>
						Judge: P{state.judgeScore.proposer}:C
						{state.judgeScore.challenger}
					</Text>
				</>
			)}
		</Box>
	);
}
