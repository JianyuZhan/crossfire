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

const MAX_TOPIC_CHARS = 1000;
const MAX_TOPIC_LINES = 4;

function formatAgentInfo(info?: AgentInfo): string {
  if (!info) return "unknown";
  if (info.agentType && info.model) return `${info.agentType} (${info.model})`;
  return info.agentType ?? info.model ?? "unknown";
}

/**
 * Returns the constant number of terminal rows this header occupies.
 * The topic Box uses a fixed height={MAX_TOPIC_LINES} with overflow="hidden",
 * so this is always the same regardless of topic length or terminal width.
 */
export function headerBarHeight(): number {
  // border(2) + title(1) + round+phase(1) + proposer(1) + challenger(1) + topic(MAX_TOPIC_LINES)
  return 2 + 4 + MAX_TOPIC_LINES;
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
  const topicDisplay =
    topic.length > MAX_TOPIC_CHARS
      ? `${topic.slice(0, MAX_TOPIC_CHARS - 1)}\u2026`
      : topic;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {/* Row 1: Branding + ID (centered) */}
      <Box justifyContent="center">
        <Text bold color="cyan">
          {"\u2694\uFE0F  C R O S S F I R E"}
        </Text>
        {debateId && (
          <Text dimColor>
            {"  "}
            {debateId}
          </Text>
        )}
      </Box>
      {/* Row 2: Round + Phase */}
      <Box>
        <Text color="cyan" bold>
          Round {currentRound}/{maxRounds}
        </Text>
        <Text>{"  "}</Text>
        <Text color="yellow">{phase}</Text>
        {modeLabel && (
          <Text color="yellow" bold>
            {modeLabel}
          </Text>
        )}
      </Box>
      {/* Row 3: Proposer */}
      <Box>
        <Text color="green" bold>
          Proposer:{" "}
        </Text>
        <Text dimColor>{formatAgentInfo(proposerInfo)}</Text>
      </Box>
      {/* Row 4: Challenger */}
      <Box>
        <Text color="red" bold>
          Challenger:{" "}
        </Text>
        <Text dimColor>{formatAgentInfo(challengerInfo)}</Text>
      </Box>
      {/* Row 5+: Topic (fixed height, clipped) */}
      <Box height={MAX_TOPIC_LINES} overflow="hidden">
        <Text color="magenta" bold>
          Topic:{" "}
        </Text>
        <Text wrap="wrap">{topicDisplay}</Text>
      </Box>
    </Box>
  );
}
