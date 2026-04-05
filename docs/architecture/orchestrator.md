# Orchestrator

> Event projection, decision logic, and live debate execution.

Back to the overview: [overview.md](./overview.md)

See also:

- [Adapter Layer](./adapter-layer.md)
- [Policy Surface](./policy-surface.md)
- [Action Plan Synthesis](./synthesis.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

The orchestrator consumes normalized adapter events, projects them into `DebateState`, runs the debate loop, and emits orchestrator events back onto the same bus.

Packages:

- `orchestrator-core` for pure logic
- `orchestrator` for side effects

## Core Types

### DebateConfig

`DebateConfig` defines debate topic, round limits, judge cadence, convergence threshold, optional policy overrides, optional prompt-template selections, and optional per-role model/system-prompt overrides.

### OrchestratorEvent

`OrchestratorEvent` currently has 19 kinds:

- `debate.started`
- `debate.resumed`
- `debate.paused`
- `debate.unpaused`
- `debate.extended`
- `turn.interrupt.requested`
- `round.started`
- `policy.baseline`
- `policy.turn.override`
- `policy.turn.override.clear`
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
- paused
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
- visible transcript-style output strips these internal JSON payloads after extraction; the structured data remains preserved in the event log

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
- `/inject judge` is live and triggers a full Judge turn with the user-provided suffix
- proposer / challenger / both `user.inject` events are consumed through the director guidance queue and appended to the next prompt for the targeted role(s)
- `/pause` and `/resume` emit replay-safe `debate.paused` / `debate.unpaused` control events; the runner honors them at turn boundaries and before judge invocations
- `/extend <N>` emits `debate.extended`, and projection updates `config.maxRounds` so replay, resume, and live execution all agree on the new round budget
- `/interrupt [role]` emits `turn.interrupt.requested`; the runner routes it to the currently active provider turn, and a successful provider interrupt ends the debate with `terminationReason: "interrupted"` or `"user-interrupt"`

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
- it resolves effective turn mode before each proposer / challenger turn using `debate default < role baseline < turn override`
- system prompt resolution is handled at the CLI layer: the runner receives pre-resolved system prompts from `config.proposerSystemPrompt` / `config.challengerSystemPrompt` / `config.judgeSystemPrompt`, falling back to `defaultSystemPrompt(role)` inside `buildInitialPrompt()`
- it appends evidence-policy guidance derived from the effective `ResolvedPolicy.evidence.bar` to live prompts and recovery context, so evidence settings shape runtime behavior even though adapters only expose them as approximate observation warnings
- it emits `policy.baseline` for each started role immediately after `debate.started`, carrying the full baseline `ResolvedPolicy`, clamp notes, preset provenance, evidence provenance (`evidence?: { source: EvidenceSource }`), template provenance (`template?: { name, basePreset? }`), translation summary, warnings, and the full `ProviderObservationResult` (tool view, capability effects, completeness) so that downstream consumers can reconstruct runtime policy state from events alone
- it emits `policy.turn.override` before sending the turn (only when a turn-level override is active) with the same observation payload, and `policy.turn.override.clear` after the turn completes
- baseline and override policy state is intentionally reconstructed from those events rather than from hidden mutable runner state
- it blocks on projected pause state between turns and before judge invocations
- it can now route `/interrupt` requests to the active provider turn and terminates the debate with `debate.completed(reason="interrupted")` when the adapter reports `turn.completed(status="interrupted")`
- it tracks schema refresh cadence for incremental prompts
- it reads `maxRounds` from projected state during execution, so live `/extend <N>` changes affect subsequent loop bounds and recovery context
- it consumes stored guidance from the director before the next targeted proposer / challenger prompt, so both degradation guidance and user injects affect turn construction
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

Current built-in role guidance also matters:

- built-in provider profiles are symmetric runtime shells for Claude, Codex, and Gemini rather than separate prompt contracts
- `general` templates emphasize constructive adversarial review for product, research, and business topics
- `code` templates emphasize repository evidence, tool-backed validation, and file/path citations for implementation topics
- custom provider profiles currently supply runtime metadata such as adapter/model defaults and `prompt_family`; role prompt bodies still come from the resolved template files under `prompts/<family>/<role>.md`

## Judge Turn

`runJudgeTurn()` is responsible for:

- sending judge prompts with the compiled baseline policy (always uses the `plan` preset policy)
- parsing `judge_verdict`
- tolerating missing tool calls
- returning graceful degradation rather than crashing the debate

Judge turns use policy only - there is no `executionMode` fallback. The runner always provides the baseline `plan` policy when invoking the judge.

The current judge contract remains score-based, but prompt guidance is action-plan-oriented:

- unsupported claims should be scored down rather than silently accepted
- the judge should not take over as a general investigator for one side
- direct fact-checking should stay minimal and targeted to contradictions in cited evidence

## Final Outcome

After the main loop exits, the runner:

1. optionally runs a final-review Judge turn
2. emits `synthesis.started`
3. builds `debate.completed.summary` via `generateSummary()`
4. runs the action-plan synthesis pipeline
5. may emit `synthesis.error` for judge-final / prompt-assembly / llm-synthesis / file-write failures
6. emits `synthesis.completed`
7. emits `debate.completed` last

Current fallback behavior is important:

- successful LLM synthesis writes markdown/HTML directly and is classified as `llm-full`
- Claude synthesis turns that submit a full `ExitPlanMode` payload without a clean `turn.completed` are recovered as `llm-recovered`
- the isolated synthesis turn is sent without tool-use encouragement so the provider is nudged toward tool-free consolidation instead of starting a fresh research pass
- timeout/error paths may retain partial synthesis text for diagnostics, but do not render that partial text as a successful final report unless a complete `ExitPlanMode` plan payload was captured
- local fallback rendering uses `draftToAuditReport(draft, summary)` so the fallback report can consume `DebateSummary` fields such as consensus, unresolved items, short recommended action, condensed judge assessment, and structured unresolved positions

The runner does not currently append a separate “Final Outcome” markdown block to the transcript.
