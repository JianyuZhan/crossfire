# Action Plan Synthesis

> Final report generation and adaptive prompt assembly.

Back to the overview: [overview.md](./overview.md)

See also:

- [Orchestrator](./orchestrator.md)
- [TUI and CLI](./tui-cli.md)

## Purpose

The action plan is the primary output of a debate. The synthesis system generates:

- `action-plan.md`
- `action-plan.html`
- `synthesis-debug.json` (prompt-assembly metadata plus runtime diagnostics for the synthesis session and final quality classification)

The preferred path is LLM-backed final synthesis in an isolated adapter session. Local fallbacks guarantee output even when synthesis fails.

## Pipeline Overview

```text
debate ends
  → PlanAccumulator.flush()
  → snapshot evolving plan
  → computeReferenceScores()
  → assembleAdaptiveSynthesisPrompt()
  → buildInstructions()
  → runFinalSynthesis()
  → render markdown to HTML
  → fallback to local report template when needed
```

The runner emits:

- `synthesis.started`
- `synthesis.error`
- `synthesis.completed`

## 4-Layer Adaptive Prompt

The synthesis prompt is assembled from four layers:

1. **Layer 1** structured state summary
2. **Layer 2** compressed round summaries
3. **Layer 3** full-text critical rounds
4. **Layer 4** quote snippets from high-value compressed rounds

Layer 4 only appears when:

- budget allows it
- scored round data exists

## Budget Tiers

`chooseInitialBudgetTier()` selects:

- **short**: full transcript fits comfortably, so all rounds can stay full text
- **medium**: use a mix of recent/high-impact full-text rounds plus compressed others
- **long**: use phase blocks plus more aggressive compression

## Round Scoring

`scoreRoundsForSynthesis()` scores rounds using:

- recency
- novelty
- concession presence
- consensus change
- risk change
- judge impact
- optional reference score

Degraded rounds keep only recency plus judge impact.

If `RoundSignals` are unavailable, selection falls back to recency-only behavior.

## Reference Scoring

`computeReferenceScores()` is a synthesis-time pass, not a live debate pass.

It currently uses:

- rebuttal back-references into earlier `keyPoints`
- judge-note reasoning that re-mentions earlier key-point text

## RoundSignals

`RoundSignals` live on `EvolvingPlan.roundSignals`.

They are produced in two ways:

- normal forward processing in `PlanAccumulator.processRound()`
- replay/reprocess rebuilding in `rebuildRoundDerivedState()`

Judge impact gets patched when `judge.completed` arrives.

## Quote Snippets

`buildQuoteSnippets()`:

- only considers compressed rounds with transcript data
- uses scored rounds to rank candidates
- extracts short 1-2 sentence excerpts
- emits snippets in ascending round order
- respects a character budget

## Phase Blocks

For long debates, the earliest compressed region can be aggregated into contiguous phase blocks.

Current implementation details:

- fixed default window size `3`
- contiguous coverage only
- promoted rounds are re-aggregated out of the remaining block coverage

## Iterative Shrink

If the assembled prompt is still too large, `shrinkToFit()` applies ordered shrink steps:

1. cut snippets
2. demote full-text rounds
3. trim summaries
4. compact Layer 1
5. emergency debate-timeline compression
6. excerpt recent full-text rounds

`shrinkTrace` records only steps that actually reduced estimated size.

## Debug Metadata

`assembleAdaptiveSynthesisPrompt()` returns:

- the final prompt
- `SynthesisDebugMetadata`

The debug payload includes:

- selected budget tier
- estimated token counts
- scores
- full-text vs compressed rounds
- round disposition
- shrink trace
- quote source rounds
- warnings
- `referenceScoreUsed`
- optional phase-block metadata

`roundDisposition` is intended to describe the final post-shrink state.
The runner projects this richer metadata down to a lighter `SynthesisAuditSummary` before attaching it to `synthesis.completed.debug`.

## Quality Tiers

Output quality tiers:

- `llm-full`
- `local-structured`
- `local-degraded`

These tiers are surfaced in `synthesis.completed`, but rendering differs by output path: the markdown renderer shows notice treatment for `local-*` results, while the local fallback report renderer maps to its own `draft-filled` / `legacy-fallback` badges.

Current classification rules:

- `llm-full` only applies when `runFinalSynthesis()` completes without an error and yields markdown
- synthesis runs that timeout or error may still retain partial text for diagnostics, but that partial output is not rendered as `llm-full`
- fallback quality is classified from the enriched local report (`consensusItems`, `unresolvedIssues`, `argumentEvolution`), not from the sparse pre-render draft alone

## Component Responsibilities

### PlanAccumulator

- subscribes to the debate bus
- collects round analyses and round signals
- records judge notes
- supports replay-safe rebuilding
- exposes `flush()` and `snapshot()`

### assembleAdaptiveSynthesisPrompt()

- pure function
- never intended to fail hard
- can reconstruct missing clean transcript data from debate turns
- performs budgeting, selection, and shrink behavior

### runFinalSynthesis()

- creates a fresh isolated session
- sends exactly one synthesis turn in `executionMode: "plan"` so synthesis is treated as tool-free consolidation rather than a new research pass
- listens directly to adapter events for that session
- prefers `message.final`, falls back to accumulated deltas
- records `SynthesisDiagnostics`
- preserves partial output for debugging even on timeout/error
- always closes the temporary session
- returns `SynthesisRunResult` with `markdown`, `durationMs`, `rawDeltaLength`, optional `error`, and optional `diagnostics`

`SynthesisDiagnostics` currently tracks:

- whether the synthesis session was created successfully
- time to first event
- tool call count
- event kind counts
- a short preview of the captured final output, when available

Adapter selection and concrete timeout policy are runner decisions, not intrinsic `runFinalSynthesis()` behavior.

### TranscriptWriter

Provides `getCleanTranscript()` for synthesis input and writes transcript outputs to disk.

### stripInternalBlocks()

Removes embedded `debate_meta` and `judge_verdict` payload blocks so transcript/synthesis inputs stay human-readable and model-appropriate.

Current detection behavior:

- strips explicit fenced blocks tagged as `debate_meta` or `judge_verdict`
- strips ` ```json ` blocks when parsed keys identify internal metadata
- falls back to key-presence matching for incomplete or malformed JSON during streaming
- strips unlabeled trailing JSON blocks prefixed by `debate_meta` or `judge_verdict`

The TUI applies the parallel `stripInternalToolBlocks()` pass before rendering streamed assistant text, so these internal JSON payloads remain in `events.jsonl` but are removed from visible transcript-style output.

## Runner Integration

The current runner:

- chooses `judge ?? proposer` as the synthesis adapter
- uses a `128_000` token budget for prompt assembly
- prefixes the adaptive prompt with `buildInstructions()`, including explicit no-exploration constraints
- passes `300_000ms` as synthesis timeout
- emits `synthesis.error` for `judge-final`, `prompt-assembly`, `llm-synthesis`, and `file-write` failures
- writes markdown and HTML when synthesis succeeds
- falls back to local report rendering when it does not
- enriches fallback rendering with a subset of `debate.completed.summary` via `draftToAuditReport(draft, summary)`
- keeps fallback summaries structured: a short recommendation, a condensed judge assessment, multi-paragraph executive summary rendering, and structured unresolved positions when the debate summary preserved them
- includes `quality` plus optional lightweight debug audit data on `synthesis.completed`
