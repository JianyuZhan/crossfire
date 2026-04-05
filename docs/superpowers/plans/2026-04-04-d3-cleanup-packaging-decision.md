# D3 — Cleanup & Packaging Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining execution-mode-first and transitional policy scaffolding, delete the obsolete `legacyToolOverrides` compatibility chain, and produce a documented packaging abstraction decision without introducing false cross-provider normalization.

**Architecture:** D3 is a product-surface cleanup phase, not a new semantic layer. It removes stale legacy fallback paths, renames or deletes transitional seams, cleans source-of-truth drift in checked-in artifacts and docs, and records explicit decisions where Phase D intentionally does **not** normalize behavior (provider-native packaging). Architecture and README docs are updated in the same commits that change contracts or user-facing terminology.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo, Markdown architecture docs, README documentation

**Expected D3 decisions:**

- `legacyToolOverrides` is **deleted** in D3. Under the current no-compatibility assumption, this compatibility bridge should not survive as a hidden second authoring path.
- Packaging remains **provider-specific** in D3. The deliverable is a documented decision plus architecture clarifications, not a normalized abstraction.

---

## File Structure

### orchestrator (packages/orchestrator)
- **Modify:** `src/judge.ts` — Remove the final `executionMode: "plan"` fallback
- **Test:** `__tests__/judge.test.ts` — Assert judge turns rely only on policy

### orchestrator-core (packages/orchestrator-core)
- **Modify:** `src/synthesis-prompt.ts` — Remove `buildFullTextSynthesisPrompt()` transitional wrapper
- **Modify:** `src/draft-report.ts` — Remove `legacy-fallback` quality type
- **Modify:** `src/report-renderer.ts` — Rename legacy fallback quality badge mapping
- **Test:** `__tests__/synthesis-prompt.test.ts` — Remove wrapper coverage, keep `assembleAdaptiveSynthesisPrompt()` coverage
- **Test:** `__tests__/draft-report.test.ts` — Update generation quality expectations
- **Test:** `__tests__/report-renderer.test.ts` — Update fallback quality rendering assertions

### adapter-core / adapters / orchestrator
- **Modify:** `packages/adapter-core/src/policy/types.ts` — Remove `legacyToolOverrides` from `CapabilityPolicy`
- **Modify:** `packages/adapter-core/src/policy/compiler.ts` — Remove legacy tool override attachment logic
- **Modify:** `packages/adapter-core/src/policy/presets.ts` — Update policy shapes after capability type cleanup
- **Modify:** `packages/adapter-core/src/testing/policy-fixtures.ts` — Remove legacy tool override fixture support
- **Modify:** `packages/adapter-claude/src/policy-translation.ts`
- **Modify:** `packages/adapter-claude/src/policy-observation.ts`
- **Modify:** `packages/adapter-codex/src/policy-translation.ts`
- **Modify:** `packages/adapter-codex/src/policy-observation.ts`
- **Modify:** `packages/adapter-gemini/src/policy-translation.ts`
- **Modify:** `packages/adapter-gemini/src/policy-observation.ts`
- **Modify:** `packages/orchestrator/src/runner.ts` — Remove preserved legacy tool override recompilation path
- **Test:** `packages/adapter-core/__tests__/policy/compiler.test.ts`
- **Test:** `packages/adapter-core/__tests__/testing/policy-helpers.test.ts`
- **Test:** `packages/adapter-claude/__tests__/policy-translation.test.ts`
- **Test:** `packages/adapter-claude/__tests__/policy-observation.test.ts`
- **Test:** `packages/adapter-codex/__tests__/policy-translation.test.ts`
- **Test:** `packages/adapter-codex/__tests__/policy-observation.test.ts`
- **Test:** `packages/adapter-gemini/__tests__/policy-translation.test.ts`
- **Test:** `packages/adapter-gemini/__tests__/policy-observation.test.ts`
- **Test:** `packages/orchestrator/__tests__/policy-runner.test.ts`
- **Verify:** `packages/cli/src/config/schema.ts` and `packages/cli/src/config/resolver.ts` contain no legacy tool-policy compatibility input

### dist / generated artifacts
- **Delete:** `packages/orchestrator-core/dist/execution-modes.*`
- **Delete:** `packages/cli/dist/commands/execution-mode-options.*`

### architecture / docs
- **Move:** `docs/architecture/execution-modes.md` → `docs/architecture/policy-surface.md`
- **Modify:** `docs/architecture/overview.md` — Update page inventory / links
- **Modify:** `docs/architecture/adapter-layer.md` — Replace execution-mode-first wording and document provider-specific packaging stance
- **Modify:** `docs/architecture/orchestrator.md` — Remove judge executionMode fallback references
- **Modify:** `docs/architecture/synthesis.md` — Remove transitional wrapper / legacy-fallback language
- **Modify:** `docs/architecture/tui-cli.md` — Replace stale execution-mode terminology with preset/policy wording
- **Modify:** `README.md` — Replace “Execution Modes” section naming and stale mode phrasing
- **Modify:** `README.zh-CN.md` — Same user-facing terminology cleanup
- **Create:** `docs/superpowers/decisions/2026-04-04-packaging-abstraction.md` — Explicit D3 packaging decision record
- **Create:** `docs/superpowers/decisions/2026-04-04-legacy-tool-overrides.md` — Explicit D3 removal decision record

---

## Task 1: Remove Judge executionMode Fallback

**Files:**
- Modify: `packages/orchestrator/src/judge.ts`
- Modify: `packages/orchestrator/__tests__/judge.test.ts`
- Modify: `docs/architecture/orchestrator.md`

The only remaining production `executionMode` usage is the judge fallback in `runJudgeTurn()`. D3 removes it completely so judge turns are policy-only, matching the Phase C/D mental model. The architecture doc updates in the same commit because this changes a runtime contract and removes the last production fallback path.

- [ ] **Step 1: Write failing judge test**

In `packages/orchestrator/__tests__/judge.test.ts`, strengthen the existing coverage so it fails until the fallback is removed:

```ts
it("never sends executionMode on judge turns", async () => {
  await runJudgeTurn(/* existing fixture setup */);
  const callArgs = mockAdapter.sendTurn.mock.calls[0]?.[1];
  expect(callArgs.policy).toBeDefined();
  expect(callArgs.executionMode).toBeUndefined();
});
```

Also update or remove any older test that still expects `executionMode: "plan"` when policy is absent.

- [ ] **Step 2: Run targeted test to verify it fails**

Run: `pnpm --filter @crossfire/orchestrator exec vitest run __tests__/judge.test.ts`

Expected: FAIL — current fallback still sets `executionMode: "plan"`.

- [ ] **Step 3: Remove the fallback from judge.ts**

In `packages/orchestrator/src/judge.ts`, remove:

```ts
// Legacy fallback: only set executionMode when no policy is provided
...(input.policy ? {} : { executionMode: "plan" as const }),
```

Judge turns should always rely on `input.policy`.

- [ ] **Step 4: Update tests and architecture docs**

In `packages/orchestrator/__tests__/judge.test.ts`:

- remove assertions that still mention `executionMode: "plan"`
- keep assertions that judge turns send `policy`

In `docs/architecture/orchestrator.md`:

- remove any remaining mention of judge `executionMode` fallback
- state explicitly that judge turns use the compiled baseline `plan` policy only

- [ ] **Step 5: Verify task**

Run:

```bash
pnpm --filter @crossfire/orchestrator exec vitest run __tests__/judge.test.ts
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/judge.ts \
  packages/orchestrator/__tests__/judge.test.ts \
  docs/architecture/orchestrator.md
git commit -m "refactor(orchestrator): remove final judge executionMode fallback"
```

---

## Task 2: Rename Architecture Surface from Execution Modes to Policy Surface

**Files:**
- Move: `docs/architecture/execution-modes.md` → `docs/architecture/policy-surface.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/adapter-layer.md`
- Modify: `docs/architecture/orchestrator.md`
- Modify: `docs/architecture/tui-cli.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

The product mental model is already policy-first. D3 removes the remaining documentation and README framing that still calls this system “execution modes”. This task is docs-only, but it is central to D3: the cleanup goal is not cosmetic, it is to remove the execution-mode-first product surface from user-facing and architecture language.

- [ ] **Step 1: Rename the architecture page**

Move:

```text
docs/architecture/execution-modes.md
→ docs/architecture/policy-surface.md
```

Keep the page content, but update the title and wording to consistently describe:

- presets
- policy resolution
- policy compilation
- runtime policy events
- inspection and status surfaces

Avoid “execution modes” except when describing historical migration context.

- [ ] **Step 2: Update architecture cross-links and overview**

In:

- `docs/architecture/overview.md`
- `docs/architecture/tui-cli.md`
- `docs/architecture/adapter-layer.md`
- `docs/architecture/orchestrator.md`

replace links and wording from `execution-modes.md` / “execution modes” to `policy-surface.md` / “policy surface” / “policy model” / “presets”, whichever is semantically correct.

Pay special attention to stale bullets like:

- “parses debate / role / per-turn execution mode options”
- “Crossfire execution modes map onto...”

These should become preset/policy phrasing instead of mode phrasing.

- [ ] **Step 3: Update README and README.zh-CN headings and prose**

In `README.md` and `README.zh-CN.md`:

- rename the “Execution Modes” section to a policy/preset-oriented name such as `Policy Presets`
- replace stale sentences like “more permissive execution mode” with preset/policy wording
- keep CLI examples unchanged where they already use `--*-preset`

- [ ] **Step 4: Verify docs-only cleanup**

Run:

```bash
rg -n "execution mode|execution modes|execution-modes\\.md" docs/architecture README.md README.zh-CN.md
```

Expected:

- no stale product-surface uses remain
- historical mentions are acceptable only inside D3 spec/plan docs, not architecture or README

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/overview.md \
  docs/architecture/policy-surface.md \
  docs/architecture/adapter-layer.md \
  docs/architecture/orchestrator.md \
  docs/architecture/tui-cli.md \
  README.md README.zh-CN.md
git rm docs/architecture/execution-modes.md
git commit -m "docs: rename execution mode architecture surface to policy surface"
```

---

## Task 3: Remove Transitional Synthesis Wrapper and Legacy Quality Naming

**Files:**
- Modify: `packages/orchestrator-core/src/synthesis-prompt.ts`
- Modify: `packages/orchestrator-core/src/draft-report.ts`
- Modify: `packages/orchestrator-core/src/report-renderer.ts`
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: `packages/orchestrator-core/__tests__/synthesis-prompt.test.ts`
- Modify: `packages/orchestrator-core/__tests__/draft-report.test.ts`
- Modify: `packages/orchestrator-core/__tests__/report-renderer.test.ts`
- Modify: `docs/architecture/synthesis.md`

Two transitional seams remain in synthesis:

1. `buildFullTextSynthesisPrompt()` is a backward-compat wrapper over `assembleAdaptiveSynthesisPrompt()`
2. `"legacy-fallback"` still appears as a report quality type even though the runtime already uses `local-degraded` terminology elsewhere

This task removes both seams in one build-passing slice.

- [ ] **Step 1: Write failing tests for post-wrapper and post-legacy naming**

In `packages/orchestrator-core/__tests__/synthesis-prompt.test.ts`:

- remove or invert wrapper-specific tests so the suite fails until the old export is gone
- add a focused test around `assembleAdaptiveSynthesisPrompt()` if needed to preserve behavior coverage

In `packages/orchestrator-core/__tests__/report-renderer.test.ts`:

```ts
it("shows minimal fallback badge for draft-minimal quality", () => {
  const m = { ...meta, generationQuality: "draft-minimal" as const };
  const html = renderActionPlanHtml(report, m);
  expect(html).toContain("Minimal fallback");
});
```

In `packages/orchestrator-core/__tests__/draft-report.test.ts`, update any unions/assertions that still allow `"legacy-fallback"`.

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
pnpm --filter @crossfire/orchestrator-core exec vitest run \
  __tests__/synthesis-prompt.test.ts \
  __tests__/draft-report.test.ts \
  __tests__/report-renderer.test.ts
```

Expected: FAIL — old wrapper/export and old quality union still exist.

- [ ] **Step 3: Remove `buildFullTextSynthesisPrompt()`**

In `packages/orchestrator-core/src/synthesis-prompt.ts`:

- delete `buildFullTextSynthesisPrompt()`
- keep `assembleAdaptiveSynthesisPrompt()` as the single maintained path
- remove any exports/tests/comments that describe the wrapper as transitional

Update any imports that still reference the wrapper.

- [ ] **Step 4: Rename `legacy-fallback` to `draft-minimal`**

Apply the rename consistently in:

- `packages/orchestrator-core/src/draft-report.ts`
- `packages/orchestrator-core/src/report-renderer.ts`
- `packages/orchestrator/src/runner.ts`

Target shape:

```ts
generationQuality: "full" | "draft-filled" | "draft-minimal";
```

Behavior stays the same; only naming and cleanup change.

- [ ] **Step 5: Update docs**

In `docs/architecture/synthesis.md`:

- remove wrapper-era wording
- replace `legacy-fallback` with `draft-minimal`
- keep the badge semantics aligned with the renderer

- [ ] **Step 6: Verify task**

Run:

```bash
pnpm --filter @crossfire/orchestrator-core exec vitest run \
  __tests__/synthesis-prompt.test.ts \
  __tests__/draft-report.test.ts \
  __tests__/report-renderer.test.ts
pnpm --filter @crossfire/orchestrator exec vitest run __tests__/policy-runner.test.ts
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator-core/src/synthesis-prompt.ts \
  packages/orchestrator-core/src/draft-report.ts \
  packages/orchestrator-core/src/report-renderer.ts \
  packages/orchestrator/src/runner.ts \
  packages/orchestrator-core/__tests__/synthesis-prompt.test.ts \
  packages/orchestrator-core/__tests__/draft-report.test.ts \
  packages/orchestrator-core/__tests__/report-renderer.test.ts \
  docs/architecture/synthesis.md
git commit -m "refactor(synthesis): remove transitional prompt wrapper and legacy quality naming"
```

---

## Task 4: Remove Orphaned dist Artifacts and Verify Source-of-Truth Cleanup

**Files:**
- Delete: `packages/orchestrator-core/dist/execution-modes.d.ts`
- Delete: `packages/orchestrator-core/dist/execution-modes.d.ts.map`
- Delete: `packages/orchestrator-core/dist/execution-modes.js`
- Delete: `packages/orchestrator-core/dist/execution-modes.js.map`
- Delete: `packages/cli/dist/commands/execution-mode-options.d.ts`
- Delete: `packages/cli/dist/commands/execution-mode-options.d.ts.map`
- Delete: `packages/cli/dist/commands/execution-mode-options.js`
- Delete: `packages/cli/dist/commands/execution-mode-options.js.map`
- Modify: `docs/architecture/overview.md` (if file layout section needs clarification)

These checked-in artifacts no longer have maintained source files. D3 removes them to realign `dist/` with actual source-of-truth paths.

- [ ] **Step 1: Verify files are orphaned before deletion**

Run:

```bash
test ! -f packages/orchestrator-core/src/execution-modes.ts
test ! -f packages/cli/src/commands/execution-mode-options.ts
```

Expected: both source paths absent.

- [ ] **Step 2: Delete the orphaned dist files**

Delete the eight files listed above.

- [ ] **Step 3: Run build and verify they do not regenerate**

Run:

```bash
pnpm build
test ! -f packages/orchestrator-core/dist/execution-modes.js
test ! -f packages/cli/dist/commands/execution-mode-options.js
```

If either file reappears, stop and inspect the build graph before committing. Do not ship a partial cleanup.

- [ ] **Step 4: Update overview/file-layout docs if needed**

If `docs/architecture/overview.md` or other architecture pages still imply those generated paths are maintained, update them in the same commit.

- [ ] **Step 5: Commit**

```bash
git rm \
  packages/orchestrator-core/dist/execution-modes.d.ts \
  packages/orchestrator-core/dist/execution-modes.d.ts.map \
  packages/orchestrator-core/dist/execution-modes.js \
  packages/orchestrator-core/dist/execution-modes.js.map \
  packages/cli/dist/commands/execution-mode-options.d.ts \
  packages/cli/dist/commands/execution-mode-options.d.ts.map \
  packages/cli/dist/commands/execution-mode-options.js \
  packages/cli/dist/commands/execution-mode-options.js.map
git add docs/architecture/overview.md
git commit -m "chore: remove orphaned execution mode dist artifacts"
```

---

## Task 5: Delete `legacyToolOverrides` End-to-End

**Files:**
- Modify: `packages/adapter-core/src/policy/types.ts`
- Modify: `packages/adapter-core/src/policy/compiler.ts`
- Modify: `packages/adapter-core/src/policy/presets.ts`
- Modify: `packages/adapter-core/src/testing/policy-fixtures.ts`
- Modify: `packages/adapter-claude/src/policy-translation.ts`
- Modify: `packages/adapter-claude/src/policy-observation.ts`
- Modify: `packages/adapter-codex/src/policy-translation.ts`
- Modify: `packages/adapter-codex/src/policy-observation.ts`
- Modify: `packages/adapter-gemini/src/policy-translation.ts`
- Modify: `packages/adapter-gemini/src/policy-observation.ts`
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: compiler / adapter / orchestrator tests that reference `legacyToolOverrides`
- Modify: `docs/architecture/policy-surface.md`
- Modify: `docs/architecture/adapter-layer.md`
- Create: `docs/superpowers/decisions/2026-04-04-legacy-tool-overrides.md`

Under the current no-compatibility assumption, `legacyToolOverrides` should not survive D3 as a hidden second authoring path. This task removes the compatibility field and its translation / observation / runner plumbing end-to-end, then records that removal explicitly.

- [ ] **Step 1: Write failing removal tests**

Update existing tests so they fail until the compatibility path is gone:

- `packages/adapter-core/__tests__/policy/compiler.test.ts`
- `packages/adapter-core/__tests__/testing/policy-helpers.test.ts`
- `packages/adapter-claude/__tests__/policy-translation.test.ts`
- `packages/adapter-claude/__tests__/policy-observation.test.ts`
- `packages/adapter-codex/__tests__/policy-translation.test.ts`
- `packages/adapter-codex/__tests__/policy-observation.test.ts`
- `packages/adapter-gemini/__tests__/policy-translation.test.ts`
- `packages/adapter-gemini/__tests__/policy-observation.test.ts`
- `packages/orchestrator/__tests__/policy-runner.test.ts`

Examples:

```ts
it("ResolvedPolicy capabilities no longer include legacyToolOverrides", () => {
  const policy = compilePolicy(makeCompileInput({ preset: "guarded", role: "proposer" }));
  expect("legacyToolOverrides" in policy.capabilities).toBe(false);
});

it("does not preserve legacy tool overrides across turn override recompilation", async () => {
  // update prior runner test to assert no legacy tool input path remains
});
```

Delete or rewrite tests whose only purpose was to preserve legacy tool compatibility.

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/compiler.test.ts
pnpm --filter @crossfire/adapter-core exec vitest run __tests__/testing/policy-helpers.test.ts
pnpm --filter @crossfire/adapter-claude exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/adapter-codex exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/adapter-gemini exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/orchestrator exec vitest run __tests__/policy-runner.test.ts
rg -n "allowed_tools|disallowed_tools|legacyToolOverrides" \
  packages/cli/src/config/schema.ts \
  packages/cli/src/config/resolver.ts
```

Expected: FAIL — current code still exposes and preserves `legacyToolOverrides`.

- [ ] **Step 3: Remove the field and compiler plumbing**

In `packages/adapter-core/src/policy/types.ts`:

- remove `legacyToolOverrides` from `CapabilityPolicy`

In `packages/adapter-core/src/policy/compiler.ts`:

- remove legacy tool override attachment logic
- simplify helper types that currently use `Omit<CapabilityPolicy, "legacyToolOverrides">`

Update `packages/adapter-core/src/policy/presets.ts` and `packages/adapter-core/src/testing/policy-fixtures.ts` to match the simplified capability shape.

- [ ] **Step 4: Remove adapter translation and observation support**

In Claude / Codex / Gemini translation and observation modules:

- delete `legacyToolOverrides` handling
- remove related warnings
- remove or rewrite tests that expected provider-specific legacy bridge behavior

The result should be a single policy surface with no hidden tool allow/deny compatibility path.

- [ ] **Step 5: Remove runner preservation logic**

In `packages/orchestrator/src/runner.ts`:

- delete preserved `legacyToolPolicyInput` plumbing
- remove any recompilation path that carries legacy tool data into turn overrides

Update runner tests accordingly.

- [ ] **Step 6: Record the removal decision and update docs**

Create `docs/superpowers/decisions/2026-04-04-legacy-tool-overrides.md` with:

- what the feature used to do
- why D3 removes it
- why templates/evidence/presets remain the only supported policy authoring surfaces
- migration note: no compatibility path retained

In `docs/architecture/policy-surface.md` and `docs/architecture/adapter-layer.md`:

- remove `legacyToolOverrides` from the documented policy model
- remove any warning/translation text that still describes the compatibility bridge

- [ ] **Step 7: Verify task**

Run:

```bash
pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/compiler.test.ts
pnpm --filter @crossfire/adapter-core exec vitest run __tests__/testing/policy-helpers.test.ts
pnpm --filter @crossfire/adapter-claude exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/adapter-codex exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/adapter-gemini exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm --filter @crossfire/orchestrator exec vitest run __tests__/policy-runner.test.ts
rg -n "allowed_tools|disallowed_tools|legacyToolOverrides" \
  packages/cli/src/config/schema.ts \
  packages/cli/src/config/resolver.ts
pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-core/src/policy/types.ts \
  packages/adapter-core/src/policy/compiler.ts \
  packages/adapter-core/src/policy/presets.ts \
  packages/adapter-core/src/testing/policy-fixtures.ts \
  packages/adapter-claude/src/policy-translation.ts \
  packages/adapter-claude/src/policy-observation.ts \
  packages/adapter-codex/src/policy-translation.ts \
  packages/adapter-codex/src/policy-observation.ts \
  packages/adapter-gemini/src/policy-translation.ts \
  packages/adapter-gemini/src/policy-observation.ts \
  packages/orchestrator/src/runner.ts \
  packages/adapter-core/__tests__/policy/compiler.test.ts \
  packages/adapter-core/__tests__/testing/policy-helpers.test.ts \
  packages/adapter-claude/__tests__/policy-translation.test.ts \
  packages/adapter-claude/__tests__/policy-observation.test.ts \
  packages/adapter-codex/__tests__/policy-translation.test.ts \
  packages/adapter-codex/__tests__/policy-observation.test.ts \
  packages/adapter-gemini/__tests__/policy-translation.test.ts \
  packages/adapter-gemini/__tests__/policy-observation.test.ts \
  packages/orchestrator/__tests__/policy-runner.test.ts \
  docs/architecture/policy-surface.md \
  docs/architecture/adapter-layer.md \
  docs/superpowers/decisions/2026-04-04-legacy-tool-overrides.md
git commit -m "refactor(policy): remove legacy tool override compatibility path"
```

---

## Task 6: Record the Packaging Abstraction Decision

**Files:**
- Create: `docs/superpowers/decisions/2026-04-04-packaging-abstraction.md`
- Modify: `docs/architecture/adapter-layer.md`
- Modify: `docs/architecture/policy-surface.md`
- Modify: `docs/architecture/overview.md` (if decision docs index is added)

The spec already leans toward keeping packaging provider-specific. D3 turns that into an explicit recorded decision. This task is primarily documentation and architecture clarification. It must **not** sneak in a normalized abstraction through observation metadata or ad hoc helper types.

- [ ] **Step 1: Gather current adapter evidence**

Before writing the decision doc, inspect the current real surfaces:

- Claude: builtin tools + MCP attachments + source tags
- Codex: capability/sandbox effects, no stable discrete tool inventory
- Gemini: coarse approval/tool visibility only

Use current architecture docs and code paths, not speculation.

- [ ] **Step 2: Write the decision document**

Create `docs/superpowers/decisions/2026-04-04-packaging-abstraction.md` with:

- problem statement
- options considered:
  - keep provider-specific
  - normalize into a Crossfire abstraction
- 4 criteria evaluation:
  - semantic honesty
  - user value
  - execution relevance
  - testability
- D3 decision: keep provider-specific
- consequence: source tags / observation metadata remain the only cross-provider packaging surface
- explicit prohibition on stealth normalization

- [ ] **Step 3: Align architecture docs**

In `docs/architecture/adapter-layer.md` and `docs/architecture/policy-surface.md`:

- state that `builtin | mcp | provider-packaged | unknown` source tags remain observation metadata, not a normalized product object
- state that any future normalization requires a new plan

If `docs/architecture/overview.md` gains a new index entry for decision docs, update it in the same commit. Otherwise leave overview alone.

- [ ] **Step 4: Verify doc consistency**

Run:

```bash
rg -n "provider-packaged|packaging abstraction|stealth normalization|normalized packaging" docs/architecture docs/superpowers/decisions
```

Verify there is no contradictory wording implying a normalized abstraction already exists.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/decisions/2026-04-04-packaging-abstraction.md \
  docs/architecture/adapter-layer.md \
  docs/architecture/policy-surface.md \
  docs/architecture/overview.md
git commit -m "docs: record provider-specific packaging decision"
```

---

## Task 7: Final D3 Verification Sweep

**Files:**
- Modify only if cleanup sweep finds leftovers

This final task is verification-first. It should not introduce new semantics. It exists to prove D3 exit criteria are actually met and to catch stale references before merge.

- [ ] **Step 1: Verify no production `executionMode` references remain**

Run:

```bash
rg -n "executionMode" packages/*/src docs/architecture README.md README.zh-CN.md
```

Expected:

- zero hits in production source
- zero hits in architecture docs
- zero hits in `README.md` / `README.zh-CN.md`

Acceptable hits may remain in tests and historical spec/plan documents under `docs/superpowers/`.

- [ ] **Step 2: Verify no stale execution-mode page references remain**

Run:

```bash
rg -n "execution-modes\\.md|Execution Modes" docs/architecture README.md README.zh-CN.md
```

Expected:

- no architecture/README references remain

- [ ] **Step 3: Verify profile-era helper files do not depend on old profile schema**

Run:

```bash
rg -n "ProfileConfig|profile schema|old profile|allowed_tools|disallowed_tools|executionMode" \
  packages/cli/src/profile/prompt-template.ts \
  packages/cli/src/profile/topic-template-classifier.ts
```

Expected:

- no dependency on removed old profile schema
- if references remain, fix them in this task's cleanup commit

- [ ] **Step 4: Verify orphaned dist files are absent**

Run:

```bash
test ! -f packages/orchestrator-core/dist/execution-modes.js
test ! -f packages/cli/dist/commands/execution-mode-options.js
```

- [ ] **Step 5: Run final targeted verification**

Run:

```bash
pnpm --filter @crossfire/orchestrator exec vitest run __tests__/judge.test.ts __tests__/policy-runner.test.ts
pnpm --filter @crossfire/orchestrator-core exec vitest run __tests__/synthesis-prompt.test.ts __tests__/draft-report.test.ts __tests__/report-renderer.test.ts
pnpm --filter @crossfire/adapter-claude exec vitest run __tests__/policy-translation.test.ts __tests__/policy-observation.test.ts
pnpm build
```

- [ ] **Step 6: If any leftovers remain, fix them in the same commit**

Do not ship a “verification only” commit that merely notes failures. Fix lingering references, rerun checks, then commit.

- [ ] **Step 7: Commit final sweep if needed**

Only create a commit if Step 5 required code or doc changes.

Suggested message:

```bash
git commit -m "chore: complete d3 cleanup verification sweep"
```

If no changes were needed, skip this commit.

---

## Completion Checklist

- [ ] Judge turns are policy-only; no production `executionMode` fallback remains
- [ ] Architecture and README terminology is policy/preset-first, not execution-mode-first
- [ ] `docs/architecture/execution-modes.md` has been replaced by `docs/architecture/policy-surface.md`
- [ ] Transitional synthesis wrapper removed
- [ ] `legacy-fallback` quality naming removed
- [ ] Orphaned dist artifacts removed and do not regenerate on build
- [ ] `legacyToolOverrides` removed end-to-end and recorded in a decision document
- [ ] Packaging decision recorded as provider-specific with explicit criteria analysis
- [ ] `pnpm build` passes after all D3 changes

---

## Exit Criteria Mapping

| Spec requirement | Plan task |
|------------------|-----------|
| Remove execution-mode-first product surface | Tasks 1, 2, 7 |
| Remove judge.ts fallback | Task 1 |
| Remove transitional wrappers | Task 3 |
| Remove orphaned dist artifacts | Task 4 |
| Evaluate `legacyToolOverrides` and remove under no-compat assumption | Task 5 |
| Record packaging abstraction decision | Task 6 |
| Keep provider-specific packaging unless strong evidence supports normalization | Task 6 |

---

## Notes for Implementers

- D3 is intentionally conservative about packaging. Do not invent a normalized packaging abstraction in code while writing the decision doc.
- Under the current no-compatibility assumption, D3 is intentionally aggressive about `legacyToolOverrides`: the expected outcome is **deletion**, not retention.
- If implementation uncovers evidence that contradicts either expected decision, stop and update the spec/plan before proceeding.
