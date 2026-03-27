# AGENTS.md — Shared Project Instructions

## North Star

> **Every feature, optimization, and architectural decision exists for one purpose — to produce deeper, more comprehensive, and more actionable action plans. The debate is a MEANS, not an end. We optimize for the quality of insight from structured adversarial reasoning, not who "wins."**
>
> - **Prompt tone**: "identify blind spots" not "defeat the opponent." Steel-man, don't straw-man.
> - **Content design**: Judge asks "what actionable steps?" not "who made the stronger case?"
> - **Convergence**: Stop when both sides agree on key action steps, not when one side is exhausted.
> - **Feature priority**: Surfacing hidden assumptions > making arguments more persuasive.
> - **Round budget**: Extra rounds only if they produce *new actionable insight*.
> - **Output**: `action-plan.html` leads with prioritized steps + owners + risks, not debate summary.

## Language Policy

- All code, comments, variable names, commit messages, and documentation MUST be in English.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm build                    # Build all packages (also typechecks)
pnpm test                     # Run all tests
pnpm --filter @crossfire/<pkg> test  # Test single package
pnpm lint                     # Biome check
pnpm lint:fix                 # Biome auto-fix
```

## Running

```bash
# Dev (no install needed)
node packages/cli/dist/index.js start \
  --proposer claude/proposer --challenger claude/challenger \
  --topic "Topic" --max-rounds 3

# Global link (requires pnpm setup)
pnpm -C packages/cli link --global
crossfire start --proposer claude/proposer --challenger claude/challenger --topic "Topic"
```

Always `pnpm build` after source changes — CLI runs from `dist/`.

## Integration Tests

```bash
RUN_INTEGRATION=1 pnpm --filter @crossfire/cli exec vitest run __tests__/smoke.integration.test.ts
# Add HAVE_CODEX=1 CODEX_MODEL=gpt-5.1-codex-mini for Codex combos
# Add HAVE_GEMINI=1 for full 9-combo matrix
```

## Architecture Documentation

- `docs/architecture.md` is the single source of truth for system design ([TOC](docs/architecture.md#table-of-contents)).
- **Any code change that alters types, interfaces, event kinds, component structure, CLI options, or data flow MUST update `docs/architecture.md` in the same commit.**
- A pre-commit hook enforces this — if code changes touch types/interfaces/events, `docs/architecture.md` must be staged too.
- Update TOC and cross-reference anchors when adding or renaming sections.

## Critical Contracts

- `sendTurn()` resolves when streaming BEGINS, not ends. Wait for `turn.completed` event.
- `onEvent()` delivers events from ALL sessions. Filter on `adapterSessionId`.
- `approve()`/`interrupt()` are `undefined` when unsupported, not no-op.
- Unknown event kinds MUST be ignored (forward compatibility).
- All state = `projectState(events[])`. No mutable accumulation.

## Coding Rules

- TDD: write failing test first, then implement, then verify. No untested code ships.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- If a change affects end-user experience, update BOTH `README.md` and `README_zh.md`.
- Logging: use structured events via DebateEventBus, not console.log.
- Forbidden: `any` type (use `unknown`), `console.log` in production code, mutable global state.
