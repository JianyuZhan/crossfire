import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { AgentPanel } from "./components/agent-panel.js";
import {
  CommandInput,
  type ParsedCommand,
} from "./components/command-input.js";
import { CommandStatusLine } from "./components/command-status-line.js";
import { FinalSummaryPanel } from "./components/final-summary-panel.js";
import { HeaderBar } from "./components/header-bar.js";
import { JudgePanel } from "./components/judge-panel.js";
import { MetricsBar } from "./components/metrics-bar.js";
import { RoundBox } from "./components/round-box.js";
import { SplitPanel } from "./components/split-panel.js";
import type { EventSource } from "./replay/event-source.js";
import type { TuiStore } from "./state/tui-store.js";
import type { JudgeRoundResult, TuiRound, TuiState } from "./state/types.js";

/** Compact one-line judge summary shown when round is collapsed */
function JudgeSummaryLine({
  result,
}: {
  result: JudgeRoundResult;
}): React.ReactElement {
  const v = result.verdict;
  const line = v
    ? `Judge (R${result.roundNumber}): ${v.leading} leads ${v.score.proposer}:${v.score.challenger} | Continue: ${v.shouldContinue ? "Yes" : "No"}`
    : `Judge (R${result.roundNumber}): no structured verdict`;
  return (
    <Box paddingX={1}>
      <Text color="yellow">{line}</Text>
    </Box>
  );
}

interface AppProps {
  store: TuiStore;
  source: EventSource;
  onCommand?: (cmd: ParsedCommand) => void;
}

/**
 * Determine which round is "active" (still has a live speaker).
 * An active round is one that exists in rounds[] but is missing
 * at least one agent snapshot, meaning a turn is in progress.
 */
function findActiveRound(state: TuiState): TuiRound | undefined {
  if (state.rounds.length === 0) return undefined;
  const last = state.rounds[state.rounds.length - 1];
  if (!last.proposer || !last.challenger) return last;
  return undefined;
}

function isCompleted(round: TuiRound): boolean {
  return !!round.proposer && !!round.challenger;
}

export function App({
  store,
  source,
  onCommand,
}: AppProps): React.ReactElement {
  const [state, setState] = useState<TuiState>(store.getState());

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setState({ ...store.getState() });
    });
    source.start();
    return () => {
      unsub();
      source.stop();
    };
  }, [store, source]);

  const handleCommand = (cmd: ParsedCommand): void => {
    if (cmd.type === "expand" || cmd.type === "collapse") {
      store.toggleRoundCollapse(cmd.roundNumber);
      return;
    }
    onCommand?.(cmd);
  };

  const maxRounds = state.metrics.maxRounds;
  const activeRound = findActiveRound(state);
  const completedRounds = state.rounds.filter(isCompleted);

  const proposerInfo = state.proposer.agentType
    ? { agentType: state.proposer.agentType, model: state.proposer.model }
    : undefined;
  const challengerInfo = state.challenger.agentType
    ? { agentType: state.challenger.agentType, model: state.challenger.model }
    : undefined;

  return (
    <Box flexDirection="column" height="100%">
      <HeaderBar
        debateId={state.metrics.debateId}
        topic={state.debateState.config.topic}
        currentRound={state.metrics.currentRound}
        maxRounds={maxRounds}
        phase={state.debateState.phase}
        mode={state.command.mode}
        proposerInfo={proposerInfo}
        challengerInfo={challengerInfo}
      />
      <Box flexDirection="column" flexGrow={1}>
        {/* Completed rounds */}
        {completedRounds.map((round) => {
          const roundJudgeResults = state.judgeResults.filter(
            (j) => j.roundNumber === round.roundNumber && j.status === "done",
          );
          if (round.collapsed) {
            const pText = round.proposer?.messageText ?? "";
            const cText = round.challenger?.messageText ?? "";
            const pSummary = pText.slice(0, 60).replace(/\n/g, " ");
            const cSummary = cText.slice(0, 60).replace(/\n/g, " ");
            const summary = `P: ${pSummary}...  C: ${cSummary}...`;
            return (
              <React.Fragment key={round.roundNumber}>
                <RoundBox
                  roundNumber={round.roundNumber}
                  maxRounds={maxRounds}
                  collapsed
                  collapsedSummary={summary}
                />
                {roundJudgeResults.map((jr, i) => (
                  <JudgeSummaryLine
                    key={`j-${round.roundNumber}-${i}`}
                    result={jr}
                  />
                ))}
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={round.roundNumber}>
              <RoundBox roundNumber={round.roundNumber} maxRounds={maxRounds}>
                <SplitPanel>
                  <AgentPanel
                    mode="snapshot"
                    role="proposer"
                    agentType={state.proposer.agentType}
                    snapshot={round.proposer!}
                  />
                  <AgentPanel
                    mode="snapshot"
                    role="challenger"
                    agentType={state.challenger.agentType}
                    snapshot={round.challenger!}
                  />
                </SplitPanel>
              </RoundBox>
              {roundJudgeResults.map((jr, i) => (
                <JudgePanel key={`j-${round.roundNumber}-${i}`} result={jr} />
              ))}
            </React.Fragment>
          );
        })}
        {/* Active round (in progress) */}
        {activeRound && (
          <RoundBox
            roundNumber={activeRound.roundNumber}
            maxRounds={maxRounds}
            active
          >
            <SplitPanel>
              {activeRound.proposer ? (
                <AgentPanel
                  mode="snapshot"
                  role="proposer"
                  agentType={state.proposer.agentType}
                  snapshot={activeRound.proposer}
                />
              ) : (
                <AgentPanel
                  mode="live"
                  role="proposer"
                  agentType={state.proposer.agentType}
                  state={state.proposer}
                />
              )}
              {activeRound.challenger ? (
                <AgentPanel
                  mode="snapshot"
                  role="challenger"
                  agentType={state.challenger.agentType}
                  snapshot={activeRound.challenger}
                />
              ) : activeRound.proposer ? (
                <AgentPanel
                  mode="live"
                  role="challenger"
                  agentType={state.challenger.agentType}
                  state={state.challenger}
                />
              ) : (
                <AgentPanel
                  mode="idle"
                  role="challenger"
                  agentType={state.challenger.agentType}
                />
              )}
            </SplitPanel>
          </RoundBox>
        )}
        {/* Active judge: visible during evaluation and after completion (until next round starts) */}
        {state.judge.visible && state.judge.judgeStatus !== "idle" && (
          <JudgePanel
            result={{
              roundNumber: state.judge.roundNumber,
              status:
                state.judge.judgeStatus === "done" ? "done" : "evaluating",
              messageText: state.judge.judgeMessageText,
              verdict: state.judge.verdict,
            }}
          />
        )}
        {/* Final summary after debate completion */}
        {state.summary && <FinalSummaryPanel summary={state.summary} />}
      </Box>
      <MetricsBar state={state.metrics} />
      <CommandStatusLine state={state.command} />
      <CommandInput state={state.command} onCommand={handleCommand} />
    </Box>
  );
}
