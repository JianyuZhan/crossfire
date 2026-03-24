import { Box, Text } from "ink";
import type React from "react";

interface AgentInfo {
  agentType?: string;
  model?: string;
}

interface HeaderBarProps {
  debateId?: string;
  topic: string;
  currentRound: number;
  maxRounds: number;
  phase: string;
  mode: "normal" | "approval" | "replay";
  proposerInfo?: AgentInfo;
  challengerInfo?: AgentInfo;
}

const MAX_TOPIC_DISPLAY = 120;

function formatAgentInfo(info?: AgentInfo): string {
  if (!info) return "unknown";
  if (info.agentType && info.model) return `${info.agentType} (${info.model})`;
  return info.agentType ?? info.model ?? "unknown";
}

/**
 * Returns the number of terminal rows this header will occupy.
 * Used by the App to compute viewport height accurately.
 */
export function headerBarHeight(): number {
  // border-top(1) + title(1) + topic(1) + agents(1) + border-bottom(1) = 5
  return 5;
}

export function HeaderBar({
  debateId,
  topic,
  currentRound,
  maxRounds,
  phase,
  mode,
  proposerInfo,
  challengerInfo,
}: HeaderBarProps): React.ReactElement {
  const modeLabel =
    mode === "replay" ? " [REPLAY]" : mode === "approval" ? " [APPROVAL]" : "";
  // Truncate topic to keep header height predictable (1 line)
  const topicDisplay =
    topic.length > MAX_TOPIC_DISPLAY
      ? `${topic.slice(0, MAX_TOPIC_DISPLAY - 1)}\u2026`
      : topic;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text bold color="cyan">
          \u2694 Crossfire
        </Text>
        {debateId && (
          <>
            <Text dimColor> {debateId}</Text>
          </>
        )}
        <Text> </Text>
        <Text color="cyan" bold>
          Round {currentRound}/{maxRounds}
        </Text>
        <Text> </Text>
        <Text dimColor>{phase}</Text>
        <Text color="yellow">{modeLabel}</Text>
        <Text> </Text>
        <Text color="green" bold>
          P:
        </Text>
        <Text dimColor>{formatAgentInfo(proposerInfo)}</Text>
        <Text> </Text>
        <Text color="red" bold>
          C:
        </Text>
        <Text dimColor>{formatAgentInfo(challengerInfo)}</Text>
      </Box>
      <Box>
        <Text color="magenta" bold>
          Topic:{" "}
        </Text>
        <Text wrap="truncate">{topicDisplay}</Text>
      </Box>
    </Box>
  );
}
