import { Box, Text } from "ink";
import type React from "react";

interface RoundBoxProps {
  roundNumber: number;
  maxRounds: number;
  active?: boolean;
  collapsed?: boolean;
  collapsedSummary?: string;
  children?: React.ReactNode;
}

export function RoundBox({
  roundNumber,
  maxRounds,
  active,
  collapsed,
  collapsedSummary,
  children,
}: RoundBoxProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={active ? "cyan" : "gray"}
    >
      <Box paddingX={1}>
        <Text bold color={active ? "yellow" : "green"}>
          {active ? "▶" : "✓"} Round {roundNumber}/{maxRounds}
        </Text>
        {collapsed && (
          <Text dimColor> [collapsed] /expand {roundNumber} to view</Text>
        )}
      </Box>
      {collapsed && collapsedSummary && (
        <Box paddingX={2}>
          <Text dimColor wrap="truncate">
            {collapsedSummary}
          </Text>
        </Box>
      )}
      {!collapsed && children}
    </Box>
  );
}
