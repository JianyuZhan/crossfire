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

const MAX_TOPIC_LENGTH = 1000;

function formatAgentInfo(info?: AgentInfo): string {
	if (!info) return "unknown";
	if (info.agentType && info.model) return `${info.agentType} (${info.model})`;
	return info.agentType ?? info.model ?? "unknown";
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
		topic.length > MAX_TOPIC_LENGTH
			? `${topic.slice(0, MAX_TOPIC_LENGTH - 3)}...`
			: topic;

	return (
		<Box flexDirection="column" borderStyle="single" paddingX={1}>
			<Box justifyContent="center">
				<Text bold color="cyan">
					Crossfire
				</Text>
				{debateId && (
					<>
						<Text> </Text>
						<Text color="magenta" bold>
							Session:{" "}
						</Text>
						<Text dimColor>{debateId}</Text>
					</>
				)}
				<Text> </Text>
				<Text dimColor>
					Round {currentRound}/{maxRounds}
				</Text>
				<Text> </Text>
				<Text dimColor>{phase}</Text>
				<Text color="yellow">{modeLabel}</Text>
			</Box>
			<Box>
				<Text color="magenta" bold>
					Topic{" "}
				</Text>
				<Text wrap="wrap">{topicDisplay}</Text>
			</Box>
			<Box>
				<Text color="green" bold>
					Proposer:{" "}
				</Text>
				<Text dimColor>{formatAgentInfo(proposerInfo)}</Text>
			</Box>
			<Box>
				<Text color="red" bold>
					Challenger:{" "}
				</Text>
				<Text dimColor>{formatAgentInfo(challengerInfo)}</Text>
			</Box>
		</Box>
	);
}
