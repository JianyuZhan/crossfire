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
 * Returns the number of terminal rows this header will occupy.
 * Accounts for topic text wrapping based on terminal width.
 */
export function headerBarHeight(
  topicLength: number,
  termWidth: number,
): number {
  const availWidth = Math.max(10, termWidth - 4); // border(2) + paddingX(2)
  const topicChars = 7 + Math.min(topicLength, MAX_TOPIC_CHARS); // "Topic: " prefix
  const topicLines = Math.min(
    MAX_TOPIC_LINES,
    Math.max(1, Math.ceil(topicChars / availWidth)),
  );
  // border(2) + title(1) + round+phase(1) + proposer(1) + challenger(1) + topicLines
  return 2 + 4 + topicLines;
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
      {/* Row 1: Branding + ID */}
      <Box>
        <Text bold color="cyan">
          {"\u2694"} Crossfire
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
      {/* Row 5+: Topic (capped height) */}
      <Box height={MAX_TOPIC_LINES}>
        <Text color="magenta" bold>
          Topic:{" "}
        </Text>
        <Text wrap="wrap">{topicDisplay}</Text>
      </Box>
    </Box>
  );
}
