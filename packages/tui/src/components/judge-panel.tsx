import { Box, Text } from "ink";
import type React from "react";
import { stripInternalToolBlocks } from "../state/strip-internal.js";
import type { JudgeRoundResult } from "../state/types.js";

interface JudgePanelProps {
	result: JudgeRoundResult;
}

export function JudgePanel({ result }: JudgePanelProps): React.ReactElement {
	const v = result.verdict;
	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor="yellow"
			paddingX={1}
		>
			<Text bold color="yellow">
				Judge Evaluation (Round {result.roundNumber})
			</Text>
			{result.status === "evaluating" && (
				<Text color="yellow">Evaluating...</Text>
			)}
			{result.messageText && (
				<Text>{stripInternalToolBlocks(result.messageText)}</Text>
			)}
			{result.status === "done" && v && (
				<Text>
					Verdict: {v.leading} leads {v.score.proposer}:{v.score.challenger}
					{" | "}Continue: {v.shouldContinue ? "Yes" : "No"}
				</Text>
			)}
			{result.status === "done" && v?.reasoning && (
				<Text dimColor>{v.reasoning}</Text>
			)}
			{result.status === "done" && v && v.shouldContinue && (
				<Text color="green" bold>
					→ Continuing to next round
				</Text>
			)}
			{result.status === "done" && v && !v.shouldContinue && (
				<Text color="red" bold>
					→ Judge decided to end debate
				</Text>
			)}
			{result.status === "done" && !v && (
				<Text dimColor>Judge did not return a structured verdict</Text>
			)}
		</Box>
	);
}
