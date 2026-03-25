# Crossfire

> **THE NORTH STAR: Every feature, optimization, and architectural decision in this project exists for one purpose — to produce deeper, more comprehensive, and more actionable action plans. The debate is a MEANS, not an end. We do not optimize for who "wins"; we optimize for the quality of insight that emerges from structured adversarial reasoning.**

## Language Policy

- All code, comments, variable names, commit messages, and documentation MUST be in English.

## Project Overview

TypeScript pnpm monorepo (8 packages). See `docs/architecture.md` for full design.

## Conventions

- Node.js 20+, ESM (`"type": "module"`), strict TypeScript
- Biome for lint/format, Vitest for testing, Turborepo for builds
- TDD: write failing test first, then implement, then verify
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- Every code change MUST include corresponding tests. No untested code ships.
- If a change affects the end-user experience (CLI behavior, TUI display, output format, new features), update BOTH `README.md` and `README_zh.md`.

## Architecture Documentation

- `docs/architecture.md` is the single source of truth for system design. It has a [Table of Contents](docs/architecture.md#table-of-contents) with anchor links for fast navigation.
- **Any code change that alters types, interfaces, event kinds, component structure, CLI options, or data flow MUST include a corresponding update to `docs/architecture.md`.**
- Use the TOC to locate the relevant section. Cross-references (internal `[text](#anchor)` links) connect related sections — update them if you rename or move headings.
- When adding new subsections, add an entry to the TOC as well.

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

---

> **REMEMBER: The goal is NOT a better debate. The goal is a better action plan. Every round of argument, every judge intervention, every convergence signal — all of it serves the final deliverable: `action-plan.html`. If a change doesn't ultimately improve the depth, completeness, or actionability of that output, question whether it belongs.**
