# Crossfire

## Language Policy

- All code, comments, variable names, commit messages, and documentation MUST be in English.

## Project Overview

TypeScript pnpm monorepo (8 packages). See `docs/architecture.md` for full design.

## Conventions

- Node.js 20+, ESM (`"type": "module"`), strict TypeScript
- Biome for lint/format, Vitest for testing, Turborepo for builds
- TDD: write failing test first, then implement, then verify
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- Every commit must include `Signed-off-by` (use `git config user.name`/`user.email`)

## Critical Contracts

- `sendTurn()` resolves when streaming BEGINS, not ends. Wait for `turn.completed` event.
- `onEvent()` delivers events from ALL sessions. Filter on `adapterSessionId`.
- `approve()`/`interrupt()` are `undefined` when unsupported, not no-op.
- Unknown event kinds MUST be ignored (forward compatibility).
- All state = `projectState(events[])`. No mutable accumulation.

## Commands

```bash
pnpm build                    # Build all packages
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
