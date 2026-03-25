import { join } from "node:path";
import { Box, Text } from "ink";
import type React from "react";
import type { DebateSummaryView, JudgeRoundResult } from "../state/types.js";

interface FinalSummaryPanelProps {
	summary: DebateSummaryView;
	lastJudgeResult?: JudgeRoundResult;
}

export function FinalSummaryPanel({
	summary,
	lastJudgeResult,
}: FinalSummaryPanelProps): React.ReactElement {
	const v = lastJudgeResult?.verdict;
	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor="green"
			paddingX={1}
		>
			<Text bold color="green">
				Final Outcome
			</Text>
			<Text>
				Termination: {summary.terminationReason} (Round{" "}
				{summary.roundsCompleted}, {summary.totalTurns} turns)
			</Text>
			{(v ?? summary.judgeScore) ? (
				<Text>
					Leading:{" "}
					<Text bold color="cyan">
						{v?.leading ?? summary.leading}
					</Text>{" "}
					(Score: {(v?.score ?? summary.judgeScore)?.proposer} vs{" "}
					{(v?.score ?? summary.judgeScore)?.challenger})
				</Text>
			) : (
				<Text>
					Leading:{" "}
					<Text bold color="cyan">
						{summary.leading}
					</Text>
				</Text>
			)}
			{v?.reasoning && (
				<Box marginTop={1}>
					<Text>
						<Text bold>Judge: </Text>
						{v.reasoning}
					</Text>
				</Box>
			)}
			{!v?.reasoning && summary.recommendedAction && (
				<Box marginTop={1}>
					<Text>
						<Text bold>Judge: </Text>
						{summary.recommendedAction}
					</Text>
				</Box>
			)}
			{summary.consensus.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Consensus ({summary.consensus.length}):</Text>
					{summary.consensus.map((c, i) => (
						<Text key={i} color="green">
							{"  "}+ {c}
						</Text>
					))}
				</Box>
			)}
			{summary.unresolved.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Unresolved ({summary.unresolved.length}):</Text>
					{summary.unresolved.map((u, i) => (
						<Text key={i} color="yellow">
							{"  "}? {u}
						</Text>
					))}
				</Box>
			)}
			{summary.outputDir && (
				<Box marginTop={1}>
					<Text dimColor>
						Report: file://{join(summary.outputDir, "action-plan.html")}
					</Text>
				</Box>
			)}
		</Box>
	);
}
