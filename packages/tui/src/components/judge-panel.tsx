import { Box, Text } from "ink";
import type React from "react";
import { stripInternalToolBlocks } from "../state/strip-internal.js";
import type { JudgeRoundResult } from "../state/types.js";

interface JudgePanelProps {
	result: JudgeRoundResult;
}

function VerdictSection({
	verdict,
}: { verdict: JudgeRoundResult["verdict"] }): React.ReactElement | null {
	if (!verdict) {
		return <Text dimColor>Judge did not return a structured verdict</Text>;
	}

	const continuationColor = verdict.shouldContinue ? "green" : "red";
	const continuationText = verdict.shouldContinue
		? "\u2192 Continuing to next round"
		: "\u2192 Judge decided to end debate";

	return (
		<>
			<Text>
				Verdict: {verdict.leading} leads {verdict.score.proposer}:
				{verdict.score.challenger}
				{" | "}Continue: {verdict.shouldContinue ? "Yes" : "No"}
			</Text>
			{verdict.reasoning && <Text dimColor>{verdict.reasoning}</Text>}
			<Text color={continuationColor} bold>
				{continuationText}
			</Text>
		</>
	);
}

export function JudgePanel({ result }: JudgePanelProps): React.ReactElement {
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
			{result.status === "done" && <VerdictSection verdict={result.verdict} />}
		</Box>
	);
}
