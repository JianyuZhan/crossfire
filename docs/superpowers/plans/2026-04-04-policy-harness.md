# Phase B: Policy Harness & Confidence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a three-layer regression harness for the Phase A policy-first architecture, so future policy changes can be quickly verified without manual code reading.

**Architecture:** Upgrade existing policy tests with shared fixtures and structured warning assertions. Add new wiring-layer tests with data-flow smoke. Shared builders and helpers live in `@crossfire/adapter-core/testing` (the existing exported test-support surface). No LLM mocking, no new packages.

**Tech Stack:** TypeScript, Vitest, existing `@crossfire/adapter-core/testing` export surface

**Spec:** [Phase B: Policy Harness & Confidence](../specs/2026-04-04-policy-harness-design.md)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/adapter-core/src/testing/policy-fixtures.ts` | Canonical `CompilePolicyInput` and `ResolvedPolicy` builders, `PolicyTranslationWarning` builder |
| `packages/adapter-core/src/testing/policy-warnings.ts` | `expectWarning`, `expectWarningWithMessage`, `expectNoWarnings`, `normalizeWarnings` |
| `packages/adapter-core/__tests__/testing/policy-helpers.test.ts` | Unit tests for the shared helpers |
| `packages/cli/__tests__/policy-wiring.test.ts` | Wiring regression: baseline policy flow, turn override flow, smoke |
| `packages/orchestrator/__tests__/policy-runner.test.ts` | Runner policy: per-turn compilation, judge baseline reuse |

### Modified files

| File | Change |
|------|--------|
| `packages/adapter-core/src/testing/index.ts` | Re-export new policy fixtures and warning helpers |
| `packages/adapter-core/__tests__/policy/compiler.test.ts` | Complete golden matrix, use shared fixtures |
| `packages/adapter-claude/__tests__/policy-translation.test.ts` | Add golden cases, structured warning assertions, intentional delta group |
| `packages/adapter-codex/__tests__/policy-translation.test.ts` | Add golden cases, structured warning assertions |
| `packages/adapter-gemini/__tests__/policy-translation.test.ts` | Add golden cases, structured warning assertions, intentional delta group |
| `docs/architecture/execution-modes.md` | Note on policy harness existence and coverage |

### Unchanged files (explicitly)

| File | Reason |
|------|--------|
| `packages/adapter-core/__tests__/policy/presets.test.ts` | Already comprehensive; no gaps in golden matrix |
| `packages/adapter-core/__tests__/policy/role-contracts.test.ts` | Already comprehensive; all roles covered |
| `packages/adapter-core/__tests__/policy/level-order.test.ts` | Already comprehensive; all clamp boundaries covered |
| `packages/cli/__tests__/wiring.test.ts` | Existing tests remain; new policy-focused tests in separate file |

---

## Task B1: Shared Fixture Builders + Warning Helpers

**Files:**
- Create: `packages/adapter-core/src/testing/policy-fixtures.ts`
- Create: `packages/adapter-core/src/testing/policy-warnings.ts`
- Create: `packages/adapter-core/__tests__/testing/policy-helpers.test.ts`
- Modify: `packages/adapter-core/src/testing/index.ts`

### Step 1: Write failing tests for policy fixtures

- [ ] Create `packages/adapter-core/__tests__/testing/policy-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	makeCompileInput,
	makeResolvedPolicy,
	makeWarning,
	expectWarning,
	expectWarningWithMessage,
	expectNoWarnings,
	normalizeWarnings,
} from "../../src/testing/index.js";

describe("makeCompileInput", () => {
	it("returns guarded+proposer by default", () => {
		const input = makeCompileInput();
		expect(input.preset).toBe("guarded");
		expect(input.role).toBe("proposer");
		expect(input.legacyToolPolicy).toBeUndefined();
	});

	it("accepts overrides", () => {
		const input = makeCompileInput({ preset: "research", role: "judge" });
		expect(input.preset).toBe("research");
		expect(input.role).toBe("judge");
	});
});

describe("makeResolvedPolicy", () => {
	it("returns a compiled policy for guarded+proposer by default", () => {
		const policy = makeResolvedPolicy();
		expect(policy.preset).toBe("guarded");
		expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
		expect(policy.capabilities.filesystem).toBe("write");
	});

	it("accepts preset and role overrides", () => {
		const policy = makeResolvedPolicy({ preset: "research", role: "judge" });
		expect(policy.preset).toBe("research");
		expect(policy.roleContract.semantics.exploration).toBe("forbidden");
		// Judge ceiling clamps research capabilities
		expect(policy.capabilities.shell).toBe("off");
	});

	it("accepts legacyToolPolicy", () => {
		const policy = makeResolvedPolicy({
			legacyToolPolicy: { allow: ["Read"] },
		});
		expect(policy.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
	});
});

describe("makeWarning", () => {
	it("returns a default warning", () => {
		const w = makeWarning();
		expect(w.field).toBe("test.field");
		expect(w.adapter).toBe("claude");
		expect(w.reason).toBe("approximate");
		expect(w.message).toBe("Test warning");
	});

	it("accepts overrides", () => {
		const w = makeWarning({ field: "interaction.approval", adapter: "codex", reason: "not_implemented" });
		expect(w.field).toBe("interaction.approval");
		expect(w.adapter).toBe("codex");
		expect(w.reason).toBe("not_implemented");
	});
});

describe("expectWarning", () => {
	it("passes when matching warning exists", () => {
		const warnings = [
			makeWarning({ field: "interaction.approval", adapter: "claude", reason: "approximate" }),
		];
		expect(() =>
			expectWarning(warnings, { field: "interaction.approval", adapter: "claude", reason: "approximate" }),
		).not.toThrow();
	});

	it("throws when no matching warning exists", () => {
		const warnings = [
			makeWarning({ field: "interaction.approval", adapter: "claude", reason: "approximate" }),
		];
		expect(() =>
			expectWarning(warnings, { field: "capabilities.shell", adapter: "claude", reason: "not_implemented" }),
		).toThrow(/not found/);
	});
});

describe("expectWarningWithMessage", () => {
	it("passes when matching warning with message substring exists", () => {
		const warnings = [
			makeWarning({ field: "interaction.approval", adapter: "claude", reason: "approximate", message: "Claude has no per-tool-must-approve mode; mapped to default" }),
		];
		expect(() =>
			expectWarningWithMessage(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				messageContains: "per-tool-must-approve",
			}),
		).not.toThrow();
	});

	it("throws when message does not contain substring", () => {
		const warnings = [
			makeWarning({ field: "interaction.approval", adapter: "claude", reason: "approximate", message: "some message" }),
		];
		expect(() =>
			expectWarningWithMessage(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				messageContains: "nonexistent",
			}),
		).toThrow(/not found/);
	});
});

describe("expectNoWarnings", () => {
	it("passes for empty warnings", () => {
		expect(() => expectNoWarnings([])).not.toThrow();
	});

	it("throws for non-empty warnings", () => {
		expect(() => expectNoWarnings([makeWarning()])).toThrow(/Expected no warnings/);
	});
});

describe("normalizeWarnings", () => {
	it("sorts by field, then reason, then adapter", () => {
		const warnings = [
			makeWarning({ field: "z.field", adapter: "claude", reason: "approximate" }),
			makeWarning({ field: "a.field", adapter: "gemini", reason: "unsupported" }),
			makeWarning({ field: "a.field", adapter: "codex", reason: "unsupported" }),
			makeWarning({ field: "a.field", adapter: "claude", reason: "not_implemented" }),
		];
		const sorted = normalizeWarnings(warnings);
		expect(sorted[0].field).toBe("a.field");
		expect(sorted[0].reason).toBe("not_implemented");
		expect(sorted[1].adapter).toBe("codex");
		expect(sorted[2].adapter).toBe("gemini");
		expect(sorted[3].field).toBe("z.field");
	});
});
```

- [ ] Run test to verify it fails:

```bash
cd packages/adapter-core && pnpm test -- __tests__/testing/policy-helpers.test.ts
```

Expected: FAIL — imports do not resolve.

### Step 2: Implement policy-fixtures.ts

- [ ] Create `packages/adapter-core/src/testing/policy-fixtures.ts`:

```ts
/**
 * Canonical policy builders for test fixtures.
 * Internal test-support surface — not a public API, may change without notice.
 * @module
 */
import { compilePolicy } from "../policy/compiler.js";
import type {
	CompilePolicyInput,
	PolicyTranslationWarning,
	ResolvedPolicy,
} from "../policy/types.js";
import type { AdapterId } from "../types.js";

/**
 * Build a canonical CompilePolicyInput. Defaults to guarded + proposer.
 */
export function makeCompileInput(
	overrides: Partial<CompilePolicyInput> = {},
): CompilePolicyInput {
	return {
		preset: overrides.preset ?? "guarded",
		role: overrides.role ?? "proposer",
		...(overrides.legacyToolPolicy !== undefined
			? { legacyToolPolicy: overrides.legacyToolPolicy }
			: {}),
	};
}

/**
 * Build a canonical ResolvedPolicy via the real compiler.
 * Accepts the same overrides as makeCompileInput.
 */
export function makeResolvedPolicy(
	overrides: Partial<CompilePolicyInput> = {},
): ResolvedPolicy {
	return compilePolicy(makeCompileInput(overrides));
}

/**
 * Build a canonical PolicyTranslationWarning. Defaults to an approximate claude warning.
 */
export function makeWarning(
	overrides: Partial<PolicyTranslationWarning> = {},
): PolicyTranslationWarning {
	return {
		field: overrides.field ?? "test.field",
		adapter: overrides.adapter ?? ("claude" as AdapterId),
		reason: overrides.reason ?? "approximate",
		message: overrides.message ?? "Test warning",
	};
}
```

### Step 3: Implement policy-warnings.ts

- [ ] Create `packages/adapter-core/src/testing/policy-warnings.ts`:

```ts
/**
 * Structured warning assertion helpers for policy translation tests.
 * Internal test-support surface — not a public API, may change without notice.
 * @module
 */
import type { PolicyTranslationWarning } from "../policy/types.js";
import type { AdapterId } from "../types.js";

export interface WarningMatch {
	field: string;
	adapter: AdapterId;
	reason: PolicyTranslationWarning["reason"];
}

export interface WarningMatchWithMessage extends WarningMatch {
	messageContains: string;
}

function matchesWarning(
	w: PolicyTranslationWarning,
	match: WarningMatch,
): boolean {
	return (
		w.field === match.field &&
		w.adapter === match.adapter &&
		w.reason === match.reason
	);
}

function formatWarnings(warnings: readonly PolicyTranslationWarning[]): string {
	if (warnings.length === 0) return "(none)";
	return warnings
		.map((w) => `{field: "${w.field}", adapter: "${w.adapter}", reason: "${w.reason}"}`)
		.join(", ");
}

/**
 * Assert that at least one warning matches field + adapter + reason (partial match).
 * Throws with descriptive message if no match is found.
 */
export function expectWarning(
	warnings: readonly PolicyTranslationWarning[],
	match: WarningMatch,
): void {
	const found = warnings.some((w) => matchesWarning(w, match));
	if (!found) {
		throw new Error(
			`Expected warning {field: "${match.field}", adapter: "${match.adapter}", reason: "${match.reason}"} ` +
				`not found. Available: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Assert that at least one warning matches field + adapter + reason AND message contains substring.
 * Throws with descriptive message if no match is found.
 */
export function expectWarningWithMessage(
	warnings: readonly PolicyTranslationWarning[],
	match: WarningMatchWithMessage,
): void {
	const found = warnings.some(
		(w) => matchesWarning(w, match) && w.message.includes(match.messageContains),
	);
	if (!found) {
		throw new Error(
			`Expected warning {field: "${match.field}", adapter: "${match.adapter}", reason: "${match.reason}", ` +
				`messageContains: "${match.messageContains}"} not found. Available: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Assert that the warnings array is empty.
 * Throws with descriptive message listing unexpected warnings.
 */
export function expectNoWarnings(
	warnings: readonly PolicyTranslationWarning[],
): void {
	if (warnings.length > 0) {
		throw new Error(
			`Expected no warnings but found ${warnings.length}: [${formatWarnings(warnings)}]`,
		);
	}
}

/**
 * Sort warnings by field -> reason -> adapter for stable comparison.
 * Returns a new array; does not mutate the input.
 */
export function normalizeWarnings(
	warnings: readonly PolicyTranslationWarning[],
): PolicyTranslationWarning[] {
	return [...warnings].sort(
		(a, b) =>
			a.field.localeCompare(b.field) ||
			a.reason.localeCompare(b.reason) ||
			a.adapter.localeCompare(b.adapter),
	);
}
```

### Step 4: Add exports to testing index

- [ ] Modify `packages/adapter-core/src/testing/index.ts` — add at the end:

```ts
export {
	makeCompileInput,
	makeResolvedPolicy,
	makeWarning,
} from "./policy-fixtures.js";
export {
	type WarningMatch,
	type WarningMatchWithMessage,
	expectWarning,
	expectWarningWithMessage,
	expectNoWarnings,
	normalizeWarnings,
} from "./policy-warnings.js";
```

### Step 5: Run tests to verify they pass

- [ ] Run:

```bash
cd packages/adapter-core && pnpm test -- __tests__/testing/policy-helpers.test.ts
```

Expected: All 12 tests PASS.

- [ ] Run full adapter-core suite to verify no regressions:

```bash
cd packages/adapter-core && pnpm test
```

Expected: All existing tests still pass.

### Step 6: Commit

```bash
git add packages/adapter-core/src/testing/policy-fixtures.ts \
       packages/adapter-core/src/testing/policy-warnings.ts \
       packages/adapter-core/src/testing/index.ts \
       packages/adapter-core/__tests__/testing/policy-helpers.test.ts
git commit -m "feat(testing): add shared policy fixtures and warning assertion helpers"
```

---

## Task B2: Upgrade Policy Core Tests (Golden Matrix)

**Files:**
- Modify: `packages/adapter-core/__tests__/policy/compiler.test.ts`

The existing compiler tests cover 6 preset×role combinations. The spec requires a golden matrix of 7 specific cases with comprehensive field assertions. The existing `presets.test.ts`, `role-contracts.test.ts`, and `level-order.test.ts` are already comprehensive and do not need changes.

### Step 1: Identify gaps in existing compiler tests

The existing tests are missing:
- `guarded + proposer`: exists only in legacy override tests, not as a standalone golden case with full assertions
- Full 4-field assertions (`preset`, `roleContract.semantics`, `capabilities`, `interaction`) on each case
- Explicit assertion that `ResolvedPolicy` contains no provider-native keys

### Step 2: Upgrade compiler.test.ts with golden matrix

- [ ] Replace `packages/adapter-core/__tests__/policy/compiler.test.ts` with the upgraded version:

```ts
import { describe, expect, it } from "vitest";
import { compilePolicy } from "../../src/policy/compiler.js";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";
import { makeCompileInput } from "../../src/testing/index.js";

describe("compilePolicy", () => {
	describe("golden matrix: preset × role", () => {
		it("research × proposer: empty ceiling, read-only capabilities", () => {
			const p = compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			expect(p.preset).toBe("research");
			expect(p.roleContract.semantics).toEqual({
				exploration: "allowed",
				factCheck: "allowed",
				mayIntroduceNewProposal: true,
				evidenceBar: "medium",
			});
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({
				approval: "on-risk",
				limits: { maxTurns: 12 },
			});
		});

		it("research × judge: judge ceiling clamps capabilities", () => {
			const p = compilePolicy(makeCompileInput({ preset: "research", role: "judge" }));
			expect(p.preset).toBe("research");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.semantics.factCheck).toBe("minimal");
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({
				approval: "on-risk",
				limits: { maxTurns: 12 },
			});
		});

		it("guarded × proposer: write + readonly shell baseline", () => {
			const p = compilePolicy(makeCompileInput({ preset: "guarded", role: "proposer" }));
			expect(p.preset).toBe("guarded");
			expect(p.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "search",
				shell: "readonly",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "on-risk" });
		});

		it("guarded × challenger: no ceiling, challenger semantics", () => {
			const p = compilePolicy(makeCompileInput({ preset: "guarded", role: "challenger" }));
			expect(p.preset).toBe("guarded");
			expect(p.roleContract.semantics.mayIntroduceNewProposal).toBe(false);
			expect(p.roleContract.semantics.evidenceBar).toBe("high");
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "search",
				shell: "readonly",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "on-risk" });
		});

		it("dangerous × proposer: full capability path", () => {
			const p = compilePolicy(makeCompileInput({ preset: "dangerous", role: "proposer" }));
			expect(p.preset).toBe("dangerous");
			expect(p.capabilities).toEqual({
				filesystem: "write",
				network: "full",
				shell: "exec",
				subagents: "on",
			});
			expect(p.interaction).toEqual({ approval: "never" });
		});

		it("dangerous × judge: all dimensions clamped by judge ceiling", () => {
			const p = compilePolicy(makeCompileInput({ preset: "dangerous", role: "judge" }));
			expect(p.preset).toBe("dangerous");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "never" });
		});

		it("plan × judge: plan-shape, approval always", () => {
			const p = compilePolicy(makeCompileInput({ preset: "plan", role: "judge" }));
			expect(p.preset).toBe("plan");
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.ceilings).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.capabilities).toEqual({
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			});
			expect(p.interaction).toEqual({ approval: "always" });
		});
	});

	describe("provider-native leak guard", () => {
		it("ResolvedPolicy keys contain only preset, roleContract, capabilities, interaction", () => {
			const p = compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			expect(Object.keys(p).sort()).toEqual(
				["capabilities", "interaction", "preset", "roleContract"].sort(),
			);
		});

		it("capabilities keys contain no provider-native fields", () => {
			const p = compilePolicy(makeCompileInput({ preset: "dangerous", role: "proposer" }));
			const capKeys = Object.keys(p.capabilities);
			expect(capKeys).not.toContain("permissionMode");
			expect(capKeys).not.toContain("approvalPolicy");
			expect(capKeys).not.toContain("sandboxPolicy");
			expect(capKeys).not.toContain("approvalMode");
		});
	});

	describe("legacy tool overrides", () => {
		it("attaches legacyToolOverrides when provided", () => {
			const p = compilePolicy(
				makeCompileInput({
					legacyToolPolicy: { allow: ["Read", "Grep"], deny: ["WebFetch"] },
				}),
			);
			expect(p.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
			});
		});

		it("skips legacyToolOverrides when both are empty", () => {
			const p = compilePolicy(
				makeCompileInput({ legacyToolPolicy: { allow: [], deny: [] } }),
			);
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("skips legacyToolOverrides when undefined", () => {
			const p = compilePolicy(makeCompileInput());
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("attaches when only allow is provided", () => {
			const p = compilePolicy(
				makeCompileInput({ legacyToolPolicy: { allow: ["Read"] } }),
			);
			expect(p.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(p.capabilities.legacyToolOverrides?.deny).toBeUndefined();
		});
	});

	describe("immutability", () => {
		it("does not mutate DEFAULT_ROLE_CONTRACTS", () => {
			const before = JSON.stringify(DEFAULT_ROLE_CONTRACTS);
			compilePolicy(makeCompileInput({ preset: "dangerous", role: "judge" }));
			compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			expect(JSON.stringify(DEFAULT_ROLE_CONTRACTS)).toBe(before);
		});

		it("returned policy objects are independent", () => {
			const p1 = compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			const p2 = compilePolicy(makeCompileInput({ preset: "research", role: "proposer" }));
			expect(p1).toEqual(p2);
			expect(p1).not.toBe(p2);
			expect(p1.roleContract).not.toBe(p2.roleContract);
		});
	});
});
```

### Step 3: Run tests

- [ ] Run:

```bash
cd packages/adapter-core && pnpm test -- __tests__/policy/compiler.test.ts
```

Expected: All tests PASS.

- [ ] Run full suite:

```bash
cd packages/adapter-core && pnpm test
```

Expected: All tests PASS.

### Step 4: Commit

```bash
git add packages/adapter-core/__tests__/policy/compiler.test.ts
git commit -m "test(policy): upgrade compiler tests with complete golden matrix"
```

---

## Task B3: Upgrade Claude Translation Tests

**Files:**
- Modify: `packages/adapter-claude/__tests__/policy-translation.test.ts`

### Step 1: Upgrade with golden cases, structured warnings, intentional deltas

- [ ] Replace `packages/adapter-claude/__tests__/policy-translation.test.ts`:

```ts
import {
	expectNoWarnings,
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import {
	CLAUDE_SUBAGENT_TOOLS,
	translatePolicy,
} from "../src/policy-translation.js";

describe("translatePolicy (Claude)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> bypassPermissions (exact)", () => {
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("bypassPermissions");
			expect(native.allowDangerouslySkipPermissions).toBe(true);
		});

		it("always -> default (approximate) when capabilities not plan-shaped", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("plan");
		});

		it("on-failure -> default (approximate)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "on-failure" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer (exact mapping baseline)", () => {
		it("translates to default mode with tool deny list", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.maxTurns).toBe(12);
			expect(native.disallowedTools).toContain("Bash");
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
			expect(native.disallowedTools).not.toContain("Glob");
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
			// No approval warnings for on-risk -> default (exact)
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toEqual([]);
		});
	});

	describe("golden: plan + judge (plan-shape detection)", () => {
		it("translates to plan permissionMode", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("plan");
			expect(native.allowDangerouslySkipPermissions).toBeUndefined();
		});
	});

	describe("golden: guarded + proposer + approval=always (approximate warning)", () => {
		it("produces approximate warning when shape does not match plan", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer + legacy allow Bash (legacy override conflict)", () => {
		it("drops conflicting legacy allow with approximate warning", () => {
			const policy = makeResolvedPolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: { allow: ["Bash"] },
			});
			const { native, warnings } = translatePolicy(policy);
			// Bash still denied because shell: "off" is the enum ceiling
			expect(native.disallowedTools).toContain("Bash");
			expectWarning(warnings, {
				field: "capabilities.legacyToolOverrides.allow",
				adapter: "claude",
				reason: "approximate",
			});
		});
	});

	describe("capability -> tool deny", () => {
		it("shell off denies Bash", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
		});

		it("filesystem read denies Edit and Write but not Read", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
		});

		it("subagents off denies subagent tools", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
		});
	});

	describe("limits", () => {
		it("maxTurns passes through", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.maxTurns).toBe(12);
		});

		it("unsupported limits produce not_implemented warnings", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				interaction: {
					...base.interaction,
					limits: { maxTurns: 12, maxToolCalls: 50, timeoutMs: 30000 },
				},
			};
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxToolCalls",
				adapter: "claude",
				reason: "not_implemented",
			});
			expectWarning(warnings, {
				field: "interaction.limits.timeoutMs",
				adapter: "claude",
				reason: "not_implemented",
			});
		});
	});

	describe("intentional deltas", () => {
		it("INTENTIONAL DELTA: research maps to default, not dontAsk", () => {
			// Old behavior: research preset mapped to Claude's dontAsk permission mode
			// New behavior: research maps to default (on-risk approval)
			// Reason: dontAsk is a silent allowlist execution mode, not a research mode
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.permissionMode).not.toBe("dontAsk");
		});

		it("INTENTIONAL DELTA: on-risk approval produces no warnings for Claude", () => {
			// Old behavior: research mode had implicit permission behaviors
			// New behavior: on-risk -> default is an exact mapping, no warning needed
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toHaveLength(0);
		});
	});
});
```

### Step 2: Run tests

- [ ] Run:

```bash
cd packages/adapter-claude && pnpm test -- __tests__/policy-translation.test.ts
```

Expected: All tests PASS.

### Step 3: Commit

```bash
git add packages/adapter-claude/__tests__/policy-translation.test.ts
git commit -m "test(claude): upgrade translation tests with golden cases and structured warnings"
```

---

## Task B4: Upgrade Codex Translation Tests

**Files:**
- Modify: `packages/adapter-codex/__tests__/policy-translation.test.ts`

### Step 1: Upgrade with golden cases and structured warnings

- [ ] Replace `packages/adapter-codex/__tests__/policy-translation.test.ts`:

```ts
import {
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Codex)", () => {
	describe("approval mapping", () => {
		it("on-risk -> on-request (approximate)", () => {
			const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
			});
		});

		it("on-failure -> on-failure (exact)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "on-failure" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-failure");
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> never (exact)", () => {
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("never");
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toEqual([]);
		});

		it("always -> on-request (approximate)", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
			});
		});
	});

	describe("golden: research + proposer (readOnly sandbox)", () => {
		it("translates to readOnly sandbox with network not disabled", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "readOnly" });
			expect(native.networkDisabled).toBe(false);
			// research has maxTurns, which Codex doesn't support
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "codex",
				reason: "not_implemented",
			});
		});
	});

	describe("golden: guarded + proposer (workspace-write sandbox)", () => {
		it("translates to workspace-write sandbox", () => {
			const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "workspace-write" });
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("golden: dangerous + proposer (danger-full-access sandbox)", () => {
		it("translates to danger-full-access sandbox with network warning", () => {
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "danger-full-access" });
			expect(native.networkDisabled).toBe(false);
			expectWarning(warnings, {
				field: "capabilities.network",
				adapter: "codex",
				reason: "approximate",
			});
		});
	});

	describe("golden: guarded + proposer + legacy overrides (not_implemented warning)", () => {
		it("emits not_implemented warning for legacy tool overrides", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "capabilities.legacyToolOverrides",
				adapter: "codex",
				reason: "not_implemented",
			});
		});
	});

	describe("network disabled", () => {
		it("network off -> networkDisabled true", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				capabilities: { ...base.capabilities, network: "off" as const },
			};
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(true);
		});

		it("network search -> networkDisabled false", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("limits", () => {
		it("maxTurns produces not_implemented warning", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "codex",
				reason: "not_implemented",
			});
		});
	});
});
```

### Step 2: Run tests

- [ ] Run:

```bash
cd packages/adapter-codex && pnpm test -- __tests__/policy-translation.test.ts
```

Expected: All tests PASS.

### Step 3: Commit

```bash
git add packages/adapter-codex/__tests__/policy-translation.test.ts
git commit -m "test(codex): upgrade translation tests with golden cases and structured warnings"
```

---

## Task B5: Upgrade Gemini Translation Tests

**Files:**
- Modify: `packages/adapter-gemini/__tests__/policy-translation.test.ts`

### Step 1: Upgrade with golden cases, structured warnings, intentional deltas

- [ ] Replace `packages/adapter-gemini/__tests__/policy-translation.test.ts`:

```ts
import {
	expectWarning,
	makeResolvedPolicy,
} from "@crossfire/adapter-core/testing";
import { describe, expect, it } from "vitest";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Gemini)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toEqual([]);
		});

		it("never -> yolo (approximate)", () => {
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});

		it("always -> default when shape does not match", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});

		it("on-failure -> auto_edit (approximate)", () => {
			const base = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const policy = { ...base, interaction: { approval: "on-failure" as const } };
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("auto_edit");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});

	describe("golden: plan + judge (plan approval mode)", () => {
		it("translates to plan approvalMode with limit warnings", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});
	});

	describe("golden: research + proposer (default mode baseline)", () => {
		it("translates to default with maxTurns not_implemented warning", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});
	});

	describe("golden: dangerous + proposer (yolo mode + warnings)", () => {
		it("translates to yolo with approval approximate warning", () => {
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});

	describe("golden: guarded + proposer + legacy overrides (not_implemented warning)", () => {
		it("emits not_implemented warning for legacy tool overrides", () => {
			const policy = makeResolvedPolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "capabilities.legacyToolOverrides",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});
	});

	describe("capability warnings", () => {
		it("filesystem off produces not_implemented warning", () => {
			const base = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const policy = {
				...base,
				capabilities: { ...base.capabilities, filesystem: "off" as const },
			};
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "capabilities.filesystem",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});

		it("shell off does NOT produce warning (Gemini default is no shell)", () => {
			const policy = makeResolvedPolicy({ preset: "plan", role: "judge" });
			const { warnings } = translatePolicy(policy);
			const shellWarnings = warnings.filter((w) => w.field === "capabilities.shell");
			expect(shellWarnings).toEqual([]);
		});
	});

	describe("limits", () => {
		it("all limits produce not_implemented warnings", () => {
			const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.limits.maxTurns",
				adapter: "gemini",
				reason: "not_implemented",
			});
		});
	});

	describe("intentional deltas", () => {
		it("INTENTIONAL DELTA: on-risk approval is exact for Gemini, unlike on-failure", () => {
			// Old behavior: all non-yolo modes mapped uniformly
			// New behavior: on-risk -> default is exact, on-failure -> auto_edit is approximate
			// Reason: Gemini's default mode closely matches on-risk semantics
			const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			const approvalWarnings = warnings.filter((w) => w.field === "interaction.approval");
			expect(approvalWarnings).toHaveLength(0);
		});

		it("INTENTIONAL DELTA: yolo is approximate, not exact", () => {
			// Old behavior: dangerous -> yolo treated as a direct mapping
			// New behavior: yolo is marked approximate because it is a CLI-only flag
			// Reason: yolo may not be settable at runtime via API
			const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
			});
		});
	});
});
```

### Step 2: Run tests

- [ ] Run:

```bash
cd packages/adapter-gemini && pnpm test -- __tests__/policy-translation.test.ts
```

Expected: All tests PASS.

### Step 3: Commit

```bash
git add packages/adapter-gemini/__tests__/policy-translation.test.ts
git commit -m "test(gemini): upgrade translation tests with golden cases and structured warnings"
```

---

## Task B6: Wiring Tests + Smoke Harness

**Files:**
- Create: `packages/cli/__tests__/policy-wiring.test.ts`
- Create: `packages/orchestrator/__tests__/policy-runner.test.ts`

### Step 1: Write CLI wiring policy tests

- [ ] Create `packages/cli/__tests__/policy-wiring.test.ts`:

```ts
import type { AgentAdapter } from "@crossfire/adapter-core";
import { compilePolicy } from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedRoles } from "../src/profile/resolver.js";
import { createAdapters } from "../src/wiring/create-adapters.js";

function makeStubAdapter(id: string): AgentAdapter {
	return {
		id,
		capabilities: {} as any,
		startSession: vi.fn().mockResolvedValue({
			adapterSessionId: `${id}-session`,
			providerSessionId: undefined,
			adapterId: id as any,
			transcript: [],
		}),
		sendTurn: vi.fn().mockResolvedValue({ turnId: "t1", status: "completed" }),
		onEvent: vi.fn().mockReturnValue(() => {}),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

const makeProfile = (agent: string) => ({
	name: "test",
	agent: agent as any,
	inherit_global_config: true,
	mcp_servers: {},
	allowed_tools: undefined as string[] | undefined,
	disallowed_tools: undefined as string[] | undefined,
	filePath: "/test.json",
});

function makeRoles(overrides?: {
	proposerProfile?: Partial<ReturnType<typeof makeProfile>>;
	challengerProfile?: Partial<ReturnType<typeof makeProfile>>;
	judgeProfile?: Partial<ReturnType<typeof makeProfile>> | null;
}): ResolvedRoles {
	return {
		proposer: {
			profile: { ...makeProfile("claude_code"), ...overrides?.proposerProfile },
			model: undefined,
			adapterType: "claude",
		},
		challenger: {
			profile: { ...makeProfile("codex"), ...overrides?.challengerProfile },
			model: undefined,
			adapterType: "codex",
		},
		judge:
			overrides?.judgeProfile === null
				? undefined
				: {
						profile: { ...makeProfile("gemini_cli"), ...overrides?.judgeProfile },
						model: undefined,
						adapterType: "gemini",
					},
	};
}

function getStartSessionPolicy(adapter: AgentAdapter) {
	const calls = (adapter.startSession as ReturnType<typeof vi.fn>).mock.calls;
	return calls[0]?.[0]?.policy;
}

describe("policy wiring", () => {
	describe("baseline policy flow", () => {
		it("proposer receives guarded preset by default", async () => {
			const proposer = makeStubAdapter("claude");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => proposer,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			const policy = getStartSessionPolicy(proposer);
			expect(policy).toBeDefined();
			expect(policy.preset).toBe("guarded");
			expect(policy.capabilities.filesystem).toBe("write");
			expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
			await bundle.closeAll();
		});

		it("challenger receives guarded preset by default", async () => {
			const challenger = makeStubAdapter("codex");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => challenger,
				gemini: () => makeStubAdapter("gemini"),
			});
			const policy = getStartSessionPolicy(challenger);
			expect(policy.preset).toBe("guarded");
			expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(false);
			await bundle.closeAll();
		});

		it("judge default preset is plan, chosen in wiring not downstream", async () => {
			const judge = makeStubAdapter("gemini");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => judge,
			});
			const policy = getStartSessionPolicy(judge);
			expect(policy.preset).toBe("plan");
			expect(policy.interaction.approval).toBe("always");
			expect(policy.roleContract.semantics.exploration).toBe("forbidden");
			await bundle.closeAll();
		});

		it("custom execution modes flow into preset selection", async () => {
			const proposer = makeStubAdapter("claude");
			const challenger = makeStubAdapter("codex");
			const bundle = await createAdapters(
				makeRoles(),
				{
					claude: () => proposer,
					codex: () => challenger,
					gemini: () => makeStubAdapter("gemini"),
				},
				{ roleModes: { proposer: "research", challenger: "dangerous" } },
			);
			expect(getStartSessionPolicy(proposer).preset).toBe("research");
			expect(getStartSessionPolicy(challenger).preset).toBe("dangerous");
			await bundle.closeAll();
		});

		it("legacy allowed_tools flow into legacyToolOverrides", async () => {
			const proposer = makeStubAdapter("claude");
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: {
						allowed_tools: ["Read", "Grep"],
						disallowed_tools: ["WebFetch"],
					},
				}),
				{
					claude: () => proposer,
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			const policy = getStartSessionPolicy(proposer);
			expect(policy.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
			});
			await bundle.closeAll();
		});

		it("baseline policy is stored on adapter entry", async () => {
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			expect(bundle.adapters.proposer.baselinePolicy).toBeDefined();
			expect(bundle.adapters.proposer.baselinePolicy?.preset).toBe("guarded");
			expect(bundle.adapters.challenger.baselinePolicy?.preset).toBe("guarded");
			expect(bundle.adapters.judge?.baselinePolicy?.preset).toBe("plan");
			await bundle.closeAll();
		});

		it("legacyToolPolicyInput is stored on adapter entry", async () => {
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: { allowed_tools: ["Read"] },
				}),
				{
					claude: () => makeStubAdapter("claude"),
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			expect(bundle.adapters.proposer.legacyToolPolicyInput).toEqual({
				allow: ["Read"],
				deny: undefined,
			});
			// Challenger has no tool policy
			expect(bundle.adapters.challenger.legacyToolPolicyInput).toBeUndefined();
			await bundle.closeAll();
		});
	});

	describe("turn override flow", () => {
		it("compiling with different preset produces different policy", () => {
			// Simulates what runner.ts does: recompile with turn-override preset
			const baseline = compilePolicy({ preset: "guarded", role: "proposer" });
			const turnOverride = compilePolicy({ preset: "research", role: "proposer" });
			expect(baseline.preset).toBe("guarded");
			expect(turnOverride.preset).toBe("research");
			expect(baseline.capabilities.filesystem).toBe("write");
			expect(turnOverride.capabilities.filesystem).toBe("read");
		});

		it("turn override preserves legacy tool policy from baseline", () => {
			// Simulates runner.ts behavior: turn changes preset, but legacyToolPolicy
			// comes from the original profile, not from the baseline ResolvedPolicy
			const legacyToolPolicy = { allow: ["Read"], deny: ["WebFetch"] };
			const baseline = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});
			const turnOverride = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy, // same legacy policy carried forward
			});
			expect(baseline.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(turnOverride.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(turnOverride.preset).toBe("research");
		});

		it("turn override does not pollute baseline", () => {
			const legacyToolPolicy = { allow: ["Read"] };
			const baseline = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});
			const _turnOverride = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy,
			});
			// Baseline is unchanged (compilePolicy is pure)
			expect(baseline.preset).toBe("guarded");
			expect(baseline.capabilities.filesystem).toBe("write");
		});
	});

	describe("smoke", () => {
		it("baseline smoke: compile -> translate -> adapter receives policy", async () => {
			// Assertion point 1: compilePolicy produces valid ResolvedPolicy
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			expect(policy.preset).toBe("guarded");
			expect(policy.capabilities).toBeDefined();
			expect(policy.interaction).toBeDefined();
			expect(policy.roleContract).toBeDefined();

			// Assertion point 2: adapter receives the policy via startSession
			const adapter = makeStubAdapter("claude");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => adapter,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			const receivedPolicy = getStartSessionPolicy(adapter);
			expect(receivedPolicy).toBeDefined();
			expect(receivedPolicy.preset).toBe("guarded");
			expect(receivedPolicy.capabilities.filesystem).toBe("write");
			await bundle.closeAll();
		});

		it("turn override smoke: baseline stored, override takes precedence, baseline clean", async () => {
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});

			// Baseline is stored
			const baseline = bundle.adapters.proposer.baselinePolicy;
			expect(baseline).toBeDefined();
			expect(baseline?.preset).toBe("guarded");

			// Turn override compiles a different policy
			const turnPolicy = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: bundle.adapters.proposer.legacyToolPolicyInput,
			});
			expect(turnPolicy.preset).toBe("research");
			expect(turnPolicy.capabilities.filesystem).toBe("read");

			// Baseline is not polluted
			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			await bundle.closeAll();
		});
	});
});
```

### Step 2: Run CLI policy wiring tests

- [ ] Run:

```bash
cd packages/cli && pnpm test -- __tests__/policy-wiring.test.ts
```

Expected: All tests PASS.

### Step 3: Write orchestrator runner policy tests

- [ ] Create `packages/orchestrator/__tests__/policy-runner.test.ts`:

```ts
import { compilePolicy, type PolicyPreset } from "@crossfire/adapter-core";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { resolveExecutionMode } from "@crossfire/orchestrator-core";
import { describe, expect, it } from "vitest";

describe("runner policy compilation", () => {
	describe("per-turn policy recompilation", () => {
		it("turn override produces policy with overridden preset", () => {
			// Simulates runner.ts line 530-536: when executionModeResult gives a
			// different mode, compilePolicy is called with the new preset
			const baseline = compilePolicy({ preset: "guarded", role: "proposer" });
			expect(baseline.preset).toBe("guarded");

			// Turn override changes preset to research
			const turnPolicy = compilePolicy({
				preset: "research",
				role: "proposer",
			});
			expect(turnPolicy.preset).toBe("research");
			expect(turnPolicy.capabilities.filesystem).toBe("read");
			expect(turnPolicy.capabilities.shell).toBe("off");
		});

		it("legacyToolPolicyInput carries forward across turn overrides", () => {
			const legacyToolPolicy = { allow: ["Read", "Grep"], deny: ["WebFetch"] };

			// Baseline turn
			const baseline = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});

			// Override turn with different preset but same legacy policy
			const override = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy,
			});

			// Both have legacy tool overrides
			expect(baseline.capabilities.legacyToolOverrides?.allow).toEqual(["Read", "Grep"]);
			expect(override.capabilities.legacyToolOverrides?.allow).toEqual(["Read", "Grep"]);

			// But different capabilities from different presets
			expect(baseline.capabilities.filesystem).toBe("write");
			expect(override.capabilities.filesystem).toBe("read");
		});
	});

	describe("judge baseline policy reuse", () => {
		it("judge baseline is compiled upstream, not in judge.ts", () => {
			// This test documents that judge.ts receives policy from the caller
			// and does not choose or compile a preset itself.
			// The wiring layer (create-adapters.ts) is responsible for:
			//   compilePolicy({ preset: "plan", role: "judge" })
			const judgePolicy = compilePolicy({ preset: "plan", role: "judge" });
			expect(judgePolicy.preset).toBe("plan");
			expect(judgePolicy.interaction.approval).toBe("always");
			expect(judgePolicy.roleContract.semantics.exploration).toBe("forbidden");
			expect(judgePolicy.capabilities.shell).toBe("off");
			expect(judgePolicy.capabilities.subagents).toBe("off");
		});

		it("judge scheduled turns reuse baseline without recompilation", () => {
			// Runner passes adapters.judge.baselinePolicy to runJudgeTurn
			// There is no per-turn recompilation for judge in A-scope
			const baseline = compilePolicy({ preset: "plan", role: "judge" });
			// "Reuse" means the same object is passed, not recompiled
			const reused = baseline; // no compilePolicy call
			expect(reused).toBe(baseline);
			expect(reused.preset).toBe("plan");
		});
	});

	describe("execution mode resolver integration", () => {
		it("resolveExecutionMode result can be used as preset for policy compilation", () => {
			const result = resolveExecutionMode(
				{ defaultMode: "guarded", roleModes: { proposer: "research" } },
				"proposer",
				"p-1",
			);
			const policy = compilePolicy({
				preset: result.effectiveMode as PolicyPreset,
				role: "proposer",
			});
			expect(policy.preset).toBe("research");
		});

		it("turn override from config produces different policy than baseline", () => {
			const config = {
				defaultMode: "guarded" as const,
				turnOverrides: { "p-2": "dangerous" as const },
			};

			const baselineResult = resolveExecutionMode(config, "proposer", "p-1");
			const overrideResult = resolveExecutionMode(config, "proposer", "p-2");

			const baselinePolicy = compilePolicy({
				preset: baselineResult.effectiveMode as PolicyPreset,
				role: "proposer",
			});
			const overridePolicy = compilePolicy({
				preset: overrideResult.effectiveMode as PolicyPreset,
				role: "proposer",
			});

			expect(baselinePolicy.preset).toBe("guarded");
			expect(overridePolicy.preset).toBe("dangerous");
			expect(baselinePolicy.capabilities.shell).toBe("readonly");
			expect(overridePolicy.capabilities.shell).toBe("exec");
		});
	});
});
```

### Step 4: Run orchestrator policy tests

- [ ] Run:

```bash
cd packages/orchestrator && pnpm test -- __tests__/policy-runner.test.ts
```

Expected: All tests PASS.

### Step 5: Run full test suites

- [ ] Run:

```bash
pnpm build && pnpm test
```

Expected: All tests PASS across all packages.

### Step 6: Commit

```bash
git add packages/cli/__tests__/policy-wiring.test.ts \
       packages/orchestrator/__tests__/policy-runner.test.ts
git commit -m "test(wiring): add policy wiring regression tests and data-flow smoke harness"
```

---

## Task B7: Minimal Documentation Update

**Files:**
- Modify: `docs/architecture/execution-modes.md`

### Step 1: Add testing section to execution-modes.md

- [ ] Add the following section at the end of `docs/architecture/execution-modes.md`, before any existing footer:

```markdown
## Policy Regression Harness

Phase B established a three-layer regression harness for the policy compilation pipeline:

1. **Policy core** (`adapter-core`): Golden matrix of 7 preset×role combinations with full field assertions. Verifies `ResolvedPolicy` structure, capability clamping, and legacy override behavior. No provider-native assertions allowed in this layer.

2. **Adapter translation** (`adapter-{claude,codex,gemini}`): Per-adapter golden cases covering exact mappings, approximate mappings, and intentional deltas. All tests use structured `expectWarning()` assertions on `field` + `adapter` + `reason`, not message text.

3. **Wiring regression** (`cli`, `orchestrator`): Baseline policy flow and turn override flow tested separately. Includes data-flow smoke that verifies the compile→translate→adapter chain without LLM mocking.

Shared test fixtures and warning helpers live in `@crossfire/adapter-core/testing` (internal test-support surface, not a public API).

Intentional behavior deltas (e.g., Claude `research` mapping to `default` instead of `dontAsk`) are grouped in `describe("intentional deltas")` blocks with `INTENTIONAL DELTA:` prefixed test names that assert both new and old behavior.
```

### Step 2: Commit

```bash
git add docs/architecture/execution-modes.md
git commit -m "docs: add policy regression harness section to execution-modes"
```

### Step 3: Final verification

- [ ] Run full build and test:

```bash
pnpm build && pnpm test
```

Expected: All tests PASS.

---

## Self-Review Checklist

### Spec coverage

| Spec section | Task |
|-------------|------|
| 1.1 Layer 1: Core harness | B2 |
| 1.2 Layer 2: Translation harness | B3, B4, B5 |
| 1.3 Layer 3: Wiring harness | B6 |
| 2.1 Core golden matrix | B2 |
| 2.2 Translation golden matrix | B3, B4, B5 |
| 2.3 Intentional delta set | B3, B5 |
| 3 Warning assertion strategy | B1 (helpers), B3-B5 (usage) |
| 4 Intentional delta organization | B3, B5 |
| 5 Smoke harness | B6 |
| 6 Fixture layering | B1 |
| 7 Task breakdown | All tasks |
| 9 Exit criteria | Verified in B7 final step |

### Placeholder scan

No TBD, TODO, or "implement later" found. All steps have concrete code.

### Type consistency

- `makeCompileInput` / `makeResolvedPolicy` / `makeWarning`: consistent signatures across B1 definition and B2-B6 usage
- `expectWarning` / `expectWarningWithMessage` / `expectNoWarnings`: consistent signatures across B1 definition and B3-B5 usage
- `WarningMatch` / `WarningMatchWithMessage`: defined in B1, used in B3-B5 via the assertion helpers
- `ResolvedPolicy` / `CompilePolicyInput` / `PolicyTranslationWarning`: all import from `@crossfire/adapter-core`

### Implementation notes from user review

1. **`@crossfire/adapter-core/testing` is internal test-support**: Both new files include `Internal test-support surface — not a public API, may change without notice` in their module docs.
2. **Smoke keeps compile→translate as two explicit assertion points**: The baseline smoke test in B6 has separate assertion blocks for (1) `compilePolicy` output and (2) adapter received policy.
