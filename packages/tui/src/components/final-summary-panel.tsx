import { Box, Text } from "ink";
import type React from "react";
import type { DebateSummaryView } from "../state/types.js";

interface FinalSummaryPanelProps {
  summary: DebateSummaryView;
}

export function FinalSummaryPanel({
  summary,
}: FinalSummaryPanelProps): React.ReactElement {
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
      {summary.judgeScore ? (
        <Text>
          Leading: {summary.leading} (Score: {summary.judgeScore.proposer} vs{" "}
          {summary.judgeScore.challenger})
        </Text>
      ) : (
        <Text>Leading: {summary.leading}</Text>
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
      {summary.recommendedAction && (
        <Box marginTop={1}>
          <Text>Judge reasoning: {summary.recommendedAction}</Text>
        </Box>
      )}
    </Box>
  );
}
