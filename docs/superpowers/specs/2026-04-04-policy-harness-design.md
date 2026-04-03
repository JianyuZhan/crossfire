# Phase B: Policy Harness & Confidence

**Date:** 2026-04-04
**Status:** Draft
**Depends on:** [Phase A: Policy Model Design](2026-04-03-policy-model-design.md)
**Scope:** Test & regression protection only; no expansion of policy capability surface

## Goal

Establish a stable regression harness for the policy-first architecture introduced in Phase A.

Phase B does **not** expand the policy capability surface. Its sole purpose is to turn Phase A semantics into a repeatable, low-cost, fast-regression test fixture system that provides confidence for future evolution.

## Background

Phase A established the primary path:

```
PresetInput -> ResolvedPolicy -> ProviderTranslationResult
```

Already in place:
- Provider-agnostic presets (research / guarded / dangerous / plan)
- `compilePolicy()` compiler
- Per-adapter `translatePolicy()`
- Baseline policy / turn policy wiring
- Legacy path compatibility fallback

Current test coverage:
- Core: 4 test files (compiler / presets / level-order / role-contracts), structured assertion style
- Per-adapter: 1 `policy-translation.test.ts` each
- **No wiring-layer tests**
- Warning assertions scattered, no unified helper
- Intentional deltas mixed into ordinary cases

---

## Scope

### In scope

- Upgrade existing policy tests into golden-oriented harness
- Complete the golden case matrix
- Introduce shared fixtures and warning assertion helpers
- Add wiring-layer regression tests
- Add pure data-flow smoke harness
- Establish explicit grouping and naming conventions for intentional deltas
- Eliminate reliance on manual code reading for policy regression detection

### Out of scope

- No new user-facing entry points
- No profile schema changes
- No `inspect-policy` / `inspect-tools` commands
- No inspect UI
- No custom presets / evidence policy
- No promotion of `mcp` to first-class capability
- No TUI changes
- No LLM response mocking
- No standalone `golden.test.ts` files
- No new `test-harness` package

---

## Design Principles

1. **Upgrade, don't duplicate**: Enhance existing test files; do not maintain a parallel golden suite
2. **Three layers aligned with Phase A**: core -> translation -> wiring, each with clear assertion boundaries
3. **High-visibility deltas**: Intentional deltas use explicit grouping + naming conventions within existing files
4. **Warnings are contract**: All translation tests must assert warnings structurally
5. **Smoke stops at data flow**: No LLM interaction; only prove the policy stack is connected
6. **Layered fixtures**: Core builders centralized; provider-specific builders co-located; no hidden shared layers

---

## 1. Three-Layer Test Structure

### 1.1 Layer 1: Policy Core Harness (upgrade existing)

**Target files** (existing, to be upgraded):
- `packages/adapter-core/__tests__/policy/compiler.test.ts`
- `packages/adapter-core/__tests__/policy/presets.test.ts`
- `packages/adapter-core/__tests__/policy/role-contracts.test.ts`
- `packages/adapter-core/__tests__/policy/level-order.test.ts`

**New files**:
- Shared fixtures and helpers under `packages/adapter-core/src/testing/` (see Section 6)

**Upgrade scope**:
- Import canonical policy builders from `@crossfire/adapter-core/testing`
- Complete the golden matrix (see Section 2)
- Enhance compiler tests: each case asserts `preset`, `roleContract.semantics`, `capabilities`, `interaction`
- Verify `ResolvedPolicy` does not leak provider-native content
- Verify `legacyToolOverrides` attach / skip behavior

**Assertion boundary**: Assert only `ResolvedPolicy` structure and values. Provider-native field assertions are **forbidden** in this layer.

### 1.2 Layer 2: Adapter Translation Harness (upgrade existing)

**Target files** (existing, to be upgraded):
- `packages/adapter-claude/__tests__/policy-translation.test.ts`
- `packages/adapter-codex/__tests__/policy-translation.test.ts`
- `packages/adapter-gemini/__tests__/policy-translation.test.ts`

**Upgrade scope**:
- Import `expectWarning()` helper from `@crossfire/adapter-core/testing` (see Section 3)
- Fix at least 4 golden cases per adapter (see Section 2)
- Add `describe("intentional deltas")` grouping (see Section 4)
- Provider-specific builders remain local to each adapter's test file

**Assertion boundary**: Assert `native` output and structured `warnings`.

### 1.3 Layer 3: Wiring Regression Harness (new)

**New files**:
- `packages/cli/__tests__/policy-wiring.test.ts`
- `packages/orchestrator/__tests__/policy-runner.test.ts`

**Coverage**:
- `create-adapters.ts`: baseline policy correctly compiled and stored on adapter entry; judge default preset (`plan`) chosen here in wiring, not downstream
- `runner.ts`: turn-level policy correctly recompiled; `legacyToolPolicyInput` correctly forwarded
- `judge.ts`: judge reuses baseline policy compiled upstream (does not choose or hardcode any preset itself)
- Legacy `allowed_tools` / `disallowed_tools` correctly flow into `legacyToolPolicy`
- Turn override changes preset but does not replace legacy tool policy
- Intentional deltas hold at the wiring layer

**Test naming discipline**: Wiring-layer tests must explicitly separate two assertion categories:

```ts
describe("baseline policy flow", () => {
  // baseline compilation, storage, forwarding
});

describe("turn override flow", () => {
  // turn preset change, legacy policy preserved, baseline not polluted
});
```

Baseline and turn override assertions must not be combined in the same test.

---

## 2. Golden Case Sets

Phase B does not pursue exhaustive combinatorial explosion. Instead, it fixes a small set of high-value cases.

### 2.1 Core Golden Matrix

The compiler tests must fix at least these combinations:

| Preset | Role | Coverage focus |
|--------|------|----------------|
| research | proposer | Empty ceiling, read-only capabilities |
| research | judge | Judge strict clamp, ceiling in effect |
| guarded | proposer | write + readonly shell baseline |
| guarded | challenger | Challenger has no ceiling |
| dangerous | proposer | Full capability path |
| dangerous | judge | All dimensions clamped by judge ceiling |
| plan | judge | Plan-shape, approval: always |

### 2.2 Translation Golden Matrix

Each adapter must fix at least 4 case types:

**Claude:**
- `research + proposer` — exact mapping baseline
- `plan + judge` — plan-shape detection
- `guarded + proposer + approval=always` — approximate warning
- `research + proposer + legacy allow ["Bash"]` — legacy override conflict

**Codex:**
- `research + proposer` — readOnly sandbox
- `guarded + proposer` — workspace-write sandbox
- `dangerous + proposer` — danger-full-access sandbox
- `guarded + proposer + legacy overrides` — not_implemented warning

**Gemini:**
- `plan + judge` — plan approval mode
- `research + proposer` — default mode baseline
- `dangerous + proposer` — yolo mode + warnings
- `guarded + proposer + legacy overrides` — not_implemented warning

### 2.3 Intentional Delta Set

Must be separately grouped and asserted (see Section 4). At minimum:

- **Claude `research -> default`**: Under the new policy path, `research` maps to `default`, not the old behavior's `dontAsk`
- **Legacy fallback path**: Old behavior preserved during compatibility period
- **Provider approximation**: Mappings explicitly marked as `approximate`

---

## 3. Warning Assertion Strategy

Warnings are part of the translation contract, not noise.

### 3.1 `expectWarning()` Helper

```ts
/**
 * Partial match: requires field / adapter / reason to match.
 * Does not require full object equality. message is not a primary assertion target.
 */
function expectWarning(
  warnings: readonly PolicyTranslationWarning[],
  match: {
    field: string;
    adapter: AdapterId;
    reason: "unsupported" | "approximate" | "not_implemented";
  },
): void;

/**
 * When message verification is needed, use contains rather than exact match.
 */
function expectWarningWithMessage(
  warnings: readonly PolicyTranslationWarning[],
  match: {
    field: string;
    adapter: AdapterId;
    reason: "unsupported" | "approximate" | "not_implemented";
    messageContains: string;
  },
): void;
```

### 3.2 Assertion Discipline

- **Primary assertion**: `field` + `adapter` + `reason` (partial match)
- **Secondary assertion**: `messageContains` when needed
- Do not freeze `message` copy as the primary contract
- `expectNoWarnings(warnings)` for cases that should produce no warnings

### 3.3 Sort Stability

If warning order may fluctuate, normalize before comparison:
1. `field` (lexicographic)
2. `reason` (lexicographic)
3. `adapter` (lexicographic)

Provide `normalizeWarnings(warnings)` helper.

### 3.4 Warning Categories That Must Be Protected

- `unsupported`
- `approximate`
- `not_implemented`

Any situation that should produce a warning must not be silently swallowed. Every translation test in Phase B must structurally assert warnings.

---

## 4. Intentional Delta Organization

### 4.1 Organization

Add explicit grouping within existing adapter translation test files. Do not create separate files:

```ts
describe("intentional deltas", () => {
  it("INTENTIONAL DELTA: research maps to default, not dontAsk", () => {
    const result = translateClaudePolicy(researchProposerPolicy);
    // New behavior holds
    expect(result.native.permissionMode).toBe("default");
    // Old behavior no longer holds
    expect(result.native.permissionMode).not.toBe("dontAsk");
    // Accompanying warning (if applicable)
  });
});
```

### 4.2 Naming and Assertion Discipline

- Test names uniformly prefixed with `INTENTIONAL DELTA:`
- Each delta case must simultaneously assert:
  1. New behavior holds
  2. Old behavior no longer holds
  3. Accompanying warning exists (if applicable)
- Delta cases must include a comment explaining what the old behavior was and why it changed

---

## 5. Smoke Harness

### 5.1 Positioning

Pure data-flow smoke. Does not verify LLM interaction. Lives within wiring test files as a `describe("smoke")` block; no separate file.

### 5.2 Two Smoke Cases

**Case 1: Baseline Smoke**

Verify the chain: `compilePolicy()` -> `translatePolicy()` -> stub adapter `startSession` input -> assert policy arrives intact.

**Case 2: Turn Override Smoke**

Verify:
1. Baseline policy is stored
2. Turn override with a different preset -> new policy generated
3. Turn policy takes precedence over baseline
4. Baseline is not polluted

### 5.3 Implementation Constraints

- Use lightweight stub adapter (records received policy parameters only)
- No LLM output mocking
- No multi-round debate logic verification
- No verification of how adapters internally consume native options

---

## 6. Fixture Layering Strategy

### 6.1 Core Builders

Location: `packages/adapter-core/src/testing/` (exported via `@crossfire/adapter-core/testing`)

This leverages the existing `./testing` export in `adapter-core`'s `package.json`. Add policy-specific test utilities alongside the existing testing helpers.

Provide:
- `makeCompileInput(overrides?)` — canonical `CompilePolicyInput` builder
- `makeResolvedPolicy(overrides?)` — canonical `ResolvedPolicy` builder
- `makeWarning(overrides?)` — canonical `PolicyTranslationWarning` builder

### 6.2 Warning Helpers

Location: Same `packages/adapter-core/src/testing/` directory, exported via `@crossfire/adapter-core/testing`.

Provide:
- `expectWarning(warnings, match)`
- `expectWarningWithMessage(warnings, match)`
- `expectNoWarnings(warnings)`
- `normalizeWarnings(warnings)`

### 6.3 Provider-Specific Builders

Each adapter's test file defines its own small set of provider-specific builders locally. These are **not** promoted to the shared layer.

Example in Claude tests:
```ts
function makeClaudeResearchProposer(): ResolvedPolicy {
  return makeResolvedPolicy({
    preset: "research",
    // Claude-specific overrides for this test scenario
  });
}
```

### 6.4 Cross-Package Import

Adapter tests import shared fixtures via the stable package export:
```ts
import { makeResolvedPolicy, expectWarning } from "@crossfire/adapter-core/testing";
```

This uses the existing `"./testing": "./dist/testing/index.js"` export in `adapter-core`'s `package.json`. No new packages, no `__tests__` directory imports, no relative cross-package paths.

---

## 7. Recommended Task Breakdown

| Task | Content | Dependencies | Parallelism |
|------|---------|--------------|-------------|
| B1 | Shared fixture builders + warning helpers in `adapter-core/testing` | None | — |
| B2 | Upgrade policy core tests (complete golden matrix) | B1 | — |
| B3 | Upgrade Claude translation tests | B1 | Parallel with B4/B5 |
| B4 | Upgrade Codex translation tests | B1 | Parallel with B3/B5 |
| B5 | Upgrade Gemini translation tests | B1 | Parallel with B3/B4 |
| B6 | Add wiring tests + smoke harness | B1, B2 | — |
| B7 | Minimal documentation update | B2-B6 | — |

B3/B4/B5 can run in parallel. Smoke harness is part of B6.

---

## 8. Review Criteria

### Good Phase B implementation

- Policy regressions immediately visible
- Intentional deltas and accidental drift distinguishable
- Does not expand user surface
- Does not reintroduce provider-first thinking in tests
- Warnings treated as contract
- Fixture layering clean, no hidden shared dependencies

### Poor Phase B implementation

- Extensive snapshots without semantic assertions
- Only happy-path coverage
- Approximate / unsupported behaviors unprotected
- New snapshots silently re-baseline old issues
- Harness harder to understand than the code it tests
- `expectWarning()` asserts message copy rather than structural fields

---

## 9. Exit Criteria

- [ ] Core 4 test files upgraded with complete golden matrix
- [ ] 3 adapter translation tests upgraded
- [ ] Intentional deltas explicitly grouped and asserted per adapter
- [ ] Warnings have structural `expectWarning()` assertions (partial match)
- [ ] Wiring-layer tests established (baseline flow / turn override flow separated)
- [ ] Smoke harness runnable (baseline + turn override)
- [ ] Fixtures layered: core builders in `adapter-core/testing`, provider builders co-located
- [ ] `pnpm build && pnpm test` passes reliably
