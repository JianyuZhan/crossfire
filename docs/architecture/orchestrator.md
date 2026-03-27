# Orchestrator

> Event projection, decision logic, and live debate execution.

Back to the overview: [overview.md](./overview.md)

See also:

- [Adapter Layer](./adapter-layer.md)
- [Action Plan Synthesis](./synthesis.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

The orchestrator consumes normalized adapter events, projects them into `DebateState`, runs the debate loop, and emits orchestrator events back onto the same bus.

Packages:

- `orchestrator-core` for pure logic
- `orchestrator` for side effects

## Core Types

### DebateConfig

`DebateConfig` defines debate topic, round limits, judge cadence, convergence threshold, and optional per-role model/system-prompt overrides.

### OrchestratorEvent

`OrchestratorEvent` currently has 14 kinds:

- `debate.started`
- `debate.resumed`
- `round.started`
- `round.completed`
- `judge.started`
- `judge.completed`
- `debate.completed`
- `user.inject`
- `clarification.requested`
- `clarification.provided`
- `director.action`
- `synthesis.started`
- `synthesis.completed`
- `synthesis.error`

Notable detail: `judge.completed.verdict` is optional.

### DebateState

`DebateState` is the pure projection target:

- config
- phase
- current round
- turns
- convergence
- optional termination reason

### DebateTurn

Each turn stores:

- `roundNumber`
- `role`
- latest final message content
- optional `DebateMeta`
- optional attached `JudgeVerdict`

### DebateMeta and JudgeVerdict

- `debate_meta` is parsed primarily from adapter `tool.call` events during projection, with fallback extraction from `message.final` fenced JSON / generic JSON / prose output
- `judge_verdict` is parsed during `runJudgeTurn()` and then emitted through `judge.completed`, with similar fenced JSON / raw JSON / prose fallbacks

### ConvergenceResult

`checkConvergence()` currently computes:

- `converged = bothWantToConclude || stanceDelta <= convergenceThreshold`
- `stanceDelta`
- `mutualConcessions`
- `bothWantToConclude`
- optional `singlePartyStrongConvergence`

`singlePartyStrongConvergence` is calculated but not currently consumed by `DebateDirector.evaluate()`.

## Projection

```ts
function projectState(events: AnyEvent[]): DebateState;
```

Projection is deterministic and replay-safe:

- `message.final` updates turn content
- `debate_meta` populates structured turn metadata
- `judge.completed` attaches verdicts
- unknown kinds are ignored

## DebateDirector

`DebateDirector` is the pure decision layer.

Responsibilities:

- evaluate current projected state
- decide whether to continue, trigger Judge, end debate, or emit informational actions
- keep guidance state for future use

### DirectorAction

Main actions:

- `continue`
- `trigger-judge`
- `end-debate`
- `inject-guidance`
- `await-user` (reserved surface, not executed by the current runner)

### Judge Trigger Strategy

Judge triggers currently come from three places:

- `judge-policy.ts` for scheduled / stagnation / degradation behavior
- `DebateDirector.evaluate()` for convergence and agent-request
- `runner.ts` for `/inject judge` and final-review Judge turns

Important behavior:

- periodic scheduling uses `judgeEveryNRounds` when positive
- adaptive scheduling is fallback-only when cadence is non-positive
- penultimate round is scheduled in current `JudgePolicy` unless blocked by `minJudgeRound`

### Clarification and Injection Status

Current implementation status is important:

- clarification intent can be parsed and categorized, but the runner does not currently emit `clarification.requested` / `clarification.provided`
- `requestIntervention` currently escalates to Judge rather than entering an `await-user` relay loop
- `/inject judge` is live
- other `user.inject` targets are audit-visible but not currently consumed in turn construction

## DebateEventBus

`DebateEventBus` is the integration point for:

- runner logic
- TUI
- event persistence
- transcript writing
- plan accumulation

It stores the full event list, supports subscriptions, and exposes projected snapshots through `snapshot()`.

## Runner

`runDebate()` is the main side-effectful debate loop.

High-level flow:

1. wire adapter event streams into the bus
2. initialize recovery context on sessions
3. emit `debate.started` or `debate.resumed`
4. execute proposer turn
5. execute challenger turn
6. evaluate via `DebateDirector`
7. execute resulting action
8. on termination, run the final-review + synthesis flow

Important notes:

- it waits for `turn.completed` on the bus
- it tracks schema refresh cadence for incremental prompts
- it stores guidance produced by the director, but current prompt builders do not yet consume that stored guidance
- `await-user` exists in the action type surface but is not currently produced by the live runner/director flow

## Context Builder

Debate prompts use incremental prompting rather than replaying the full transcript each turn.

Core principle:

- provider session/thread memory acts as short-term working memory
- `DebateState` is the authoritative structured long-term memory

Prompt builder families:

- `buildInitialPrompt()`
- `buildIncrementalPrompt()`
- `buildJudgeInitialPrompt()`
- `buildJudgeIncrementalPrompt()`
- `buildTranscriptRecoveryPrompt()`

## Judge Turn

`runJudgeTurn()` is responsible for:

- sending judge prompts
- parsing `judge_verdict`
- tolerating missing tool calls
- returning graceful degradation rather than crashing the debate

## Final Outcome

After the main loop exits, the runner:

1. optionally runs a final-review Judge turn
2. emits `synthesis.started`
3. builds `debate.completed.summary` via `generateSummary()`
4. runs the action-plan synthesis pipeline
5. may emit `synthesis.error` for judge-final / prompt-assembly / llm-synthesis / file-write failures
6. emits `synthesis.completed`
7. emits `debate.completed` last

The runner does not currently append a separate “Final Outcome” markdown block to the transcript.
