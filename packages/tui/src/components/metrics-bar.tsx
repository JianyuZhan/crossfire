import { Box, Text } from "ink";
import type React from "react";
import type { MetricsState, ViewportState } from "../state/types.js";

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
  viewport?: ViewportState;
}

export function MetricsBar({
  state,
  viewport,
}: MetricsBarProps): React.ReactElement {
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
      {viewport && (
        <>
          <Text dimColor> | </Text>
          {viewport.autoFollow ? (
            <>
              <Text color="green" bold>
                {"\u25CF"} LIVE
              </Text>
              <Text color="green" dimColor>
                {" "}
                {"\u2191\u2193"}arrow to scroll
              </Text>
            </>
          ) : (
            <>
              <Text color="yellow" bold>
                {"\u25CB"} SCROLLED{" "}
                {Math.max(
                  1,
                  viewport.contentHeight -
                    viewport.scrollOffset -
                    viewport.viewportHeight +
                    1,
                )}
                /{viewport.contentHeight}
              </Text>
              <Text color="cyan" bold>
                {" "}
                {"\u2193\u2193"}Ctrl+D
              </Text>
              <Text color="cyan"> or </Text>
              <Text color="cyan" bold>
                /bottom
              </Text>
              <Text color="cyan"> {"\u2192"} LIVE</Text>
            </>
          )}
        </>
      )}
    </Box>
  );
}
