# D2 — Policy Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote evidence policy to a first-class section of ResolvedPolicy, and add flat custom policy templates with Zod-validated config, independent evidence resolution chain, and surface updates across inspection/status/docs.

**Architecture:** Evidence becomes `ResolvedPolicy.evidence: EvidencePolicy` with its own resolution chain (`EvidenceSource`) independent from preset. Custom templates are flat `{ name, basePreset?, overrides? }` entries in config that compile into normal `CompilePolicyInput` + evidence overrides. Both flow through the existing compilation → observation → event → TUI state pipeline.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm monorepo (adapter-core, cli, orchestrator, orchestrator-core, tui, 3 adapter packages)

---

## File Structure

### adapter-core (packages/adapter-core)
- **Modify:** `src/policy/types.ts` — Add `EvidencePolicy`, move `evidenceBar` from `RoleSemantics` to `RoleContract.evidenceDefaults`, add `evidence` to `ResolvedPolicy`, add `evidenceOverride` to `CompilePolicyInput`
- **Modify:** `src/policy/role-contracts.ts` — Restructure `DEFAULT_ROLE_CONTRACTS` for new `evidenceDefaults` shape
- **Modify:** `src/policy/compiler.ts` — Merge evidence into compiled output
- **Modify:** `src/policy/observation-types.ts` — Add `EvidenceSource` type
- **Modify:** `src/testing/policy-fixtures.ts` — Update `makeCompileInput` and `makeResolvedPolicy` for evidence
- **Test:** `__tests__/policy/compiler.test.ts` — Update golden matrix + add evidence tests

### Adapters (packages/adapter-claude, adapter-codex, adapter-gemini)
- **Modify:** Each adapter's `policy-observation.ts` — Add evidence translation warning
- **Test:** Each adapter's `__tests__/policy-observation.test.ts` — Add evidence warning test

### cli (packages/cli)
- **Modify:** `src/config/schema.ts` — Add `EvidenceBarSchema`, `PolicyTemplateConfigSchema`, `templates` array, evidence/template fields to role config
- **Modify:** `src/config/resolver.ts` — Add evidence + template resolution to `ResolvedRoleRuntimeConfig` and `resolveAllRoles`
- **Create:** `src/config/evidence-resolution.ts` — `resolveRoleEvidence()` function
- **Create:** `src/config/template-resolution.ts` — `resolveTemplate()` function
- **Modify:** `src/commands/preset-options.ts` — Add `--evidence-bar` CLI option parsing
- **Modify:** `src/commands/inspection-context.ts` — Add evidence provenance to `RoleInspectionSuccess`
- **Modify:** `src/commands/inspection-renderers.ts` — Add evidence display section
- **Modify:** `src/commands/inspection-reports.ts` — Add evidence field to JSON reports
- **Modify:** `src/wiring/create-adapters.ts` — Pass evidence override into `compilePolicyWithDiagnostics`
- **Test:** `__tests__/config/schema.test.ts` — Template validation tests
- **Create:** `__tests__/config/evidence-resolution.test.ts`
- **Create:** `__tests__/config/template-resolution.test.ts`
- **Test:** `__tests__/commands/inspection-renderers.test.ts` — Evidence display tests

### orchestrator-core (packages/orchestrator-core)
- **Modify:** `src/orchestrator-events.ts` — Add `EvidenceSource` to policy events and `RuntimePolicyState`

### orchestrator (packages/orchestrator)
- **Modify:** `src/runner.ts` — Pass evidence through `emitBaselinePolicyEvents` and turn override

### tui (packages/tui)
- **Modify:** `src/status/status-renderers.ts` — Replace forward-compatible cast with real `evidence` access
- **Modify:** `src/status/status-view-models.ts` — No changes needed (ResolvedPolicy already flows through)

### Documentation
- **Modify:** `docs/architecture/orchestrator.md` — Evidence in policy events
- **Modify:** `docs/architecture/tui-cli.md` — Evidence in inspection + status
- **Modify:** `docs/architecture/execution-modes.md` — Evidence section, templates

---

## Task 1: Evidence Types and Compiler Extension

**Files:**
- Modify: `packages/adapter-core/src/policy/types.ts`
- Modify: `packages/adapter-core/src/policy/role-contracts.ts`
- Modify: `packages/adapter-core/src/policy/compiler.ts`
- Modify: `packages/adapter-core/src/testing/policy-fixtures.ts`
- Test: `packages/adapter-core/__tests__/policy/compiler.test.ts`

This task promotes `evidenceBar` from `RoleSemantics` into a top-level `evidence` section on `ResolvedPolicy`, adds `evidenceDefaults` to `RoleContract`, and extends the compiler to merge evidence.

---

- [ ] **Step 1: Write failing tests for evidence in compiler output**

Add tests to `packages/adapter-core/__tests__/policy/compiler.test.ts`:

```typescript
// Add at the end of the "golden matrix" describe block:

it("evidence defaults: proposer gets medium bar from role contract", () => {
	const p = compilePolicy(
		makeCompileInput({ preset: "guarded", role: "proposer" }),
	);
	expect(p.evidence).toEqual({ bar: "medium" });
	expect(p.roleContract.evidenceDefaults).toEqual({ bar: "medium" });
});

it("evidence defaults: challenger gets high bar from role contract", () => {
	const p = compilePolicy(
		makeCompileInput({ preset: "guarded", role: "challenger" }),
	);
	expect(p.evidence).toEqual({ bar: "high" });
	expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
});

it("evidence defaults: judge gets high bar from role contract", () => {
	const p = compilePolicy(
		makeCompileInput({ preset: "plan", role: "judge" }),
	);
	expect(p.evidence).toEqual({ bar: "high" });
	expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
});

it("evidenceOverride overrides role contract default", () => {
	const p = compilePolicy(
		makeCompileInput({
			preset: "guarded",
			role: "proposer",
			evidenceOverride: { bar: "high" },
		}),
	);
	expect(p.evidence).toEqual({ bar: "high" });
});

it("evidenceOverride with undefined bar falls back to role contract", () => {
	const p = compilePolicy(
		makeCompileInput({
			preset: "guarded",
			role: "proposer",
			evidenceOverride: {},
		}),
	);
	expect(p.evidence).toEqual({ bar: "medium" });
});

it("interactionOverride overrides approval from preset", () => {
	const p = compilePolicy(
		makeCompileInput({
			preset: "guarded",
			role: "proposer",
			interactionOverride: { approval: "always" },
		}),
	);
	expect(p.interaction.approval).toBe("always");
});

it("interactionOverride overrides maxTurns from preset", () => {
	const p = compilePolicy(
		makeCompileInput({
			preset: "research",
			role: "proposer",
			interactionOverride: { limits: { maxTurns: 5 } },
		}),
	);
	expect(p.interaction.limits?.maxTurns).toBe(5);
});

it("interactionOverride without fields keeps preset defaults", () => {
	const p = compilePolicy(
		makeCompileInput({
			preset: "guarded",
			role: "proposer",
			interactionOverride: {},
		}),
	);
	expect(p.interaction).toEqual({ approval: "on-risk" });
});
```

Update the provider-native leak guard test:

```typescript
// Replace the existing "ResolvedPolicy keys" test:
it("ResolvedPolicy keys contain only preset, roleContract, capabilities, interaction, evidence", () => {
	const p = compilePolicy(
		makeCompileInput({ preset: "research", role: "proposer" }),
	);
	expect(Object.keys(p).sort()).toEqual(
		["capabilities", "evidence", "interaction", "preset", "roleContract"].sort(),
	);
});
```

Update existing golden-matrix assertions that check `semantics` to remove `evidenceBar`:

```typescript
// In "research x proposer" test, replace the semantics assertion:
expect(p.roleContract.semantics).toEqual({
	exploration: "allowed",
	factCheck: "allowed",
	mayIntroduceNewProposal: true,
});

// In "guarded x challenger" test, remove:
//   expect(p.roleContract.semantics.evidenceBar).toBe("high");
// Replace with:
expect(p.roleContract.evidenceDefaults).toEqual({ bar: "high" });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/adapter-core/__tests__/policy/compiler.test.ts`
Expected: Multiple failures — `evidence` property does not exist, `evidenceDefaults` does not exist, `evidenceOverride` not a valid key.

- [ ] **Step 3: Update types in types.ts**

In `packages/adapter-core/src/policy/types.ts`:

Remove `evidenceBar` from `RoleSemantics`:

```typescript
export type RoleSemantics = {
	readonly exploration: ExplorationLevel;
	readonly factCheck: FactCheckLevel;
	readonly mayIntroduceNewProposal: boolean;
};
```

Add `EvidencePolicy` type (after `InteractionPolicy`):

```typescript
export type EvidencePolicy = {
	readonly bar: EvidenceBar;
};
```

Add `evidenceDefaults` to `RoleContract`:

```typescript
export type RoleContract = {
	readonly semantics: RoleSemantics;
	readonly ceilings: CapabilityCeilings;
	readonly evidenceDefaults: {
		readonly bar: EvidenceBar;
	};
};
```

Add `evidence` to `ResolvedPolicy`:

```typescript
export type ResolvedPolicy = {
	readonly preset: PolicyPreset;
	readonly roleContract: RoleContract;
	readonly capabilities: CapabilityPolicy;
	readonly interaction: InteractionPolicy;
	readonly evidence: EvidencePolicy;
};
```

Add `evidenceOverride` and `interactionOverride` to `CompilePolicyInput`:

```typescript
export type CompilePolicyInput = {
	readonly preset: PolicyPreset;
	readonly role: DebateRole;
	readonly legacyToolPolicy?: LegacyToolPolicyInput;
	readonly evidenceOverride?: {
		readonly bar?: EvidenceBar;
	};
	readonly interactionOverride?: {
		readonly approval?: ApprovalLevel;
		readonly limits?: {
			readonly maxTurns?: number;
		};
	};
};
```

- [ ] **Step 4: Update role-contracts.ts**

In `packages/adapter-core/src/policy/role-contracts.ts`, restructure all three role contracts:

```typescript
export const DEFAULT_ROLE_CONTRACTS: Readonly<
	Record<DebateRole, RoleContract>
> = deepFreeze({
	proposer: {
		semantics: {
			exploration: "allowed",
			factCheck: "allowed",
			mayIntroduceNewProposal: true,
		},
		ceilings: {},
		evidenceDefaults: { bar: "medium" },
	},
	challenger: {
		semantics: {
			exploration: "allowed",
			factCheck: "allowed",
			mayIntroduceNewProposal: false,
		},
		ceilings: {},
		evidenceDefaults: { bar: "high" },
	},
	judge: {
		semantics: {
			exploration: "forbidden",
			factCheck: "minimal",
			mayIntroduceNewProposal: false,
		},
		ceilings: {
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		},
		evidenceDefaults: { bar: "high" },
	},
});
```

- [ ] **Step 5: Update compiler.ts**

In `packages/adapter-core/src/policy/compiler.ts`:

Update `copyRoleContract` to include `evidenceDefaults`:

```typescript
function copyRoleContract(rc: RoleContract): RoleContract {
	return {
		semantics: { ...rc.semantics },
		ceilings: { ...rc.ceilings },
		evidenceDefaults: { ...rc.evidenceDefaults },
	};
}
```

Update `compilePolicyInternal` to merge evidence and interaction overrides:

```typescript
function compilePolicyInternal(
	input: CompilePolicyInput,
): CompilePolicyDiagnostics {
	const { preset, role, legacyToolPolicy, evidenceOverride, interactionOverride } = input;

	const presetExpansion = PRESET_EXPANSIONS[preset];
	const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

	const { capabilities: clampedCapabilities, clamps } =
		clampCapabilitiesWithNotes(
			presetExpansion.capabilities,
			roleContract.ceilings,
		);

	const capabilities = applyLegacyToolOverrides(
		clampedCapabilities,
		legacyToolPolicy,
	);

	const evidence = {
		bar: evidenceOverride?.bar ?? roleContract.evidenceDefaults.bar,
	};

	const baseInteraction = presetExpansion.interaction;
	const interaction = interactionOverride
		? {
				approval: interactionOverride.approval ?? baseInteraction.approval,
				...(interactionOverride.limits?.maxTurns !== undefined ||
				baseInteraction.limits
					? {
							limits: {
								...baseInteraction.limits,
								...(interactionOverride.limits?.maxTurns !== undefined
									? { maxTurns: interactionOverride.limits.maxTurns }
									: {}),
							},
						}
					: {}),
			}
		: baseInteraction;

	return {
		policy: {
			preset,
			roleContract,
			capabilities,
			interaction,
			evidence,
		},
		clamps,
	};
}
```

- [ ] **Step 6: Update policy-fixtures.ts**

In `packages/adapter-core/src/testing/policy-fixtures.ts`:

Update `makeCompileInput` to accept `evidenceOverride`:

```typescript
export function makeCompileInput(
	overrides: Partial<CompilePolicyInput> = {},
): CompilePolicyInput {
	return {
		preset: overrides.preset ?? "guarded",
		role: overrides.role ?? "proposer",
		...(overrides.legacyToolPolicy !== undefined
			? { legacyToolPolicy: overrides.legacyToolPolicy }
			: {}),
		...(overrides.evidenceOverride !== undefined
			? { evidenceOverride: overrides.evidenceOverride }
			: {}),
		...(overrides.interactionOverride !== undefined
			? { interactionOverride: overrides.interactionOverride }
			: {}),
	};
}
```

- [ ] **Step 7: Run adapter-core tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/adapter-core/__tests__/policy/compiler.test.ts`
Expected: All compiler tests PASS.

- [ ] **Step 8: Fix all downstream packages for the breaking type change**

The `ResolvedPolicy` shape change is cross-package. The monorepo must build cleanly before committing. Run:

```bash
cd /Users/jyzhan/code/crossfire && pnpm build
```

If any downstream package fails to compile, fix the type references immediately. The most likely breakages:

1. **Tests referencing `semantics.evidenceBar`** — grep the entire monorepo:
```bash
rg "semantics\.evidenceBar|semantics.evidenceBar" packages/ --type ts
```
Change every hit from `p.roleContract.semantics.evidenceBar` to `p.roleContract.evidenceDefaults.bar`.

2. **Test assertions on `RoleSemantics` object shape** — any `toEqual` that includes `evidenceBar` must drop it.

3. **TUI status-renderers.ts forward-compatible cast** — replace the `(policy as Record<string, unknown>).evidence` cast block in `renderPolicySummary` with typed access:
```typescript
if (policy.evidence) {
	lines.push("  Evidence:");
	lines.push(`    bar: ${policy.evidence.bar}`);
}
```

4. **Any code constructing `RoleContract` or `RoleSemantics` in test fixtures** — add `evidenceDefaults` where `RoleContract` is built, remove `evidenceBar` where `RoleSemantics` is built.

After fixing, run again:
```bash
pnpm build && pnpm test
```
Expected: Full monorepo build and test suite PASS.

- [ ] **Step 9: Update architecture docs for the type change**

Update `docs/architecture/orchestrator.md` to reflect that `ResolvedPolicy` now has a top-level `evidence: EvidencePolicy` section, and that `evidenceBar` has moved from `RoleSemantics` to `RoleContract.evidenceDefaults`.

- [ ] **Step 10: Commit**

```bash
git add packages/adapter-core/src/policy/types.ts packages/adapter-core/src/policy/role-contracts.ts packages/adapter-core/src/policy/compiler.ts packages/adapter-core/src/testing/policy-fixtures.ts packages/adapter-core/__tests__/policy/compiler.test.ts packages/tui/src/status/status-renderers.ts docs/architecture/orchestrator.md
# Also add any other files fixed in Step 8
git commit -m "feat(policy): promote evidence to ResolvedPolicy top-level section

Move evidenceBar from RoleSemantics to RoleContract.evidenceDefaults.
Add EvidencePolicy type and evidence field to ResolvedPolicy.
Add evidenceOverride to CompilePolicyInput for override resolution.
Compiler merges evidence from override or role-contract defaults.
Fix all downstream type references for breaking shape change."
```

---

## Task 2: Adapter Evidence Translation

**Files:**
- Modify: `packages/adapter-claude/src/policy-observation.ts`
- Modify: `packages/adapter-codex/src/policy-observation.ts`
- Modify: `packages/adapter-gemini/src/policy-observation.ts`
- Test: `packages/adapter-claude/__tests__/policy-observation.test.ts`
- Test: `packages/adapter-codex/__tests__/policy-observation.test.ts`
- Test: `packages/adapter-gemini/__tests__/policy-observation.test.ts`

Each adapter must handle `ResolvedPolicy.evidence` honestly: emit an `approximate` warning because no provider can natively distinguish or enforce evidence bar levels — the setting influences prompting and observation summaries only. Fix any remaining compilation errors from the Task 1 type changes.

---

- [ ] **Step 1: Write failing test for Claude evidence warning**

Add to `packages/adapter-claude/__tests__/policy-observation.test.ts`:

```typescript
import { makeResolvedPolicy } from "@crossfire/adapter-core";
import { describe, expect, it } from "vitest";
import { inspectPolicy } from "../src/policy-observation.js";

// Add inside existing test file, or create new describe block:
describe("evidence translation", () => {
	it("emits approximate warning for evidence.bar", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const evidenceWarning = result.warnings.find(
			(w) => w.field === "evidence.bar",
		);
		expect(evidenceWarning).toBeDefined();
		expect(evidenceWarning?.reason).toBe("approximate");
		expect(evidenceWarning?.adapter).toBe("claude");
	});

	it("includes evidence.bar in approximateFields", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		expect(result.translation.approximateFields).toContain("evidence.bar");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build --filter=@crossfire/adapter-core && pnpm vitest run packages/adapter-claude/__tests__/policy-observation.test.ts`
Expected: FAIL — no warning with `field: "evidence.bar"` exists yet.

- [ ] **Step 3: Add evidence warning to Claude adapter**

In `packages/adapter-claude/src/policy-observation.ts`, add evidence warning in `inspectPolicy`:

```typescript
export function inspectPolicy(
	policy: ResolvedPolicy,
): ProviderObservationResult {
	const approval = resolveApproval(policy);
	const capabilityEffects = resolveCapabilityEffects(policy);
	const toolResolution = resolveToolView(policy);
	const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

	const evidenceWarnings: PolicyTranslationWarning[] = [];
	if (policy.evidence) {
		evidenceWarnings.push({
			field: "evidence.bar",
			adapter: "claude",
			reason: "approximate",
			message: `Claude cannot natively enforce evidence bar; setting influences prompting only (configured: ${policy.evidence.bar})`,
		});
	}

	const allWarnings = [
		...approval.warnings,
		...toolResolution.warnings,
		...limitsWarnings,
		...evidenceWarnings,
	];

	const translation: PolicyTranslationSummary = {
		adapter: "claude",
		nativeSummary: {
			permissionMode: approval.permissionMode,
			maxTurns: policy.interaction.limits?.maxTurns,
		},
		exactFields: allWarnings.length === 0 ? ["interaction.approval"] : [],
		approximateFields: allWarnings
			.filter((w) => w.reason === "approximate")
			.map((w) => w.field),
		unsupportedFields: allWarnings
			.filter((w) => w.reason === "not_implemented")
			.map((w) => w.field),
	};

	return {
		translation,
		toolView: toolResolution.toolView,
		capabilityEffects,
		warnings: allWarnings,
		completeness: classifyCompleteness(),
	};
}
```

- [ ] **Step 4: Fix any `RoleSemantics` references in Claude adapter**

Check if `policy-observation.ts` or `policy-translation.ts` access `semantics.evidenceBar`. If so, change to `evidence.bar`. (Currently Claude adapter does not access `evidenceBar`, so this should be a no-op — verify with build.)

- [ ] **Step 5: Run Claude tests to verify they pass**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build --filter=@crossfire/adapter-claude && pnpm vitest run packages/adapter-claude/__tests__/policy-observation.test.ts`
Expected: PASS.

- [ ] **Step 6: Write failing test + fix for Codex adapter**

Add to `packages/adapter-codex/__tests__/policy-observation.test.ts` (same pattern as Claude):

```typescript
describe("evidence translation", () => {
	it("emits approximate warning for evidence.bar", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const evidenceWarning = result.warnings.find(
			(w) => w.field === "evidence.bar",
		);
		expect(evidenceWarning).toBeDefined();
		expect(evidenceWarning?.reason).toBe("approximate");
		expect(evidenceWarning?.adapter).toBe("codex");
	});
});
```

In `packages/adapter-codex/src/policy-observation.ts`, add evidence warning in `inspectPolicy` (before `allWarnings`):

```typescript
const evidenceWarnings: PolicyTranslationWarning[] = [];
if (policy.evidence) {
	evidenceWarnings.push({
		field: "evidence.bar",
		adapter: "codex",
		reason: "approximate",
		message: `Codex cannot natively enforce evidence bar; setting influences prompting only (configured: ${policy.evidence.bar})`,
	});
}

const allWarnings = [
	...approval.warnings,
	...sandbox.warnings,
	...legacyWarnings,
	...limitsWarnings,
	...evidenceWarnings,
];
```

- [ ] **Step 7: Write failing test + fix for Gemini adapter**

Same pattern as Codex. Add to `packages/adapter-gemini/__tests__/policy-observation.test.ts`:

```typescript
describe("evidence translation", () => {
	it("emits approximate warning for evidence.bar", () => {
		const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
		const result = inspectPolicy(policy);
		const evidenceWarning = result.warnings.find(
			(w) => w.field === "evidence.bar",
		);
		expect(evidenceWarning).toBeDefined();
		expect(evidenceWarning?.reason).toBe("approximate");
		expect(evidenceWarning?.adapter).toBe("gemini");
	});
});
```

In `packages/adapter-gemini/src/policy-observation.ts`, add evidence warning in `inspectPolicy` (same pattern).

- [ ] **Step 8: Build and run all adapter tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm vitest run packages/adapter-claude/__tests__ packages/adapter-codex/__tests__ packages/adapter-gemini/__tests__`
Expected: All PASS. The full build succeeds (no type errors from the `ResolvedPolicy` change).

- [ ] **Step 9: Commit**

```bash
git add packages/adapter-claude/src/policy-observation.ts packages/adapter-codex/src/policy-observation.ts packages/adapter-gemini/src/policy-observation.ts packages/adapter-claude/__tests__ packages/adapter-codex/__tests__ packages/adapter-gemini/__tests__
git commit -m "feat(adapters): add evidence translation warnings

All three adapters now emit approximate warning for evidence.bar,
since no provider can natively distinguish evidence bar levels.
Evidence influences prompting only; limitation visible in inspect/status."
```

---

## Task 3: Template Config Schema and Validation

**Files:**
- Modify: `packages/cli/src/config/schema.ts`
- Create: `packages/cli/__tests__/config/schema.test.ts`

Add Zod schemas for `EvidenceBar`, `PolicyTemplateConfig`, the `templates` array on `CrossfireConfig`, and `template`/`evidence` fields on `RoleProfileConfig`. Validate unique template names and valid `basePreset` references.

---

- [ ] **Step 1: Write failing schema validation tests**

Create `packages/cli/__tests__/config/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CrossfireConfigSchema } from "../../src/config/schema.js";

const MINIMAL_CONFIG = {
	providerBindings: [{ name: "b1", adapter: "claude" as const }],
	roles: {
		proposer: { binding: "b1" },
		challenger: { binding: "b1" },
	},
};

describe("CrossfireConfigSchema", () => {
	describe("templates", () => {
		it("accepts config without templates", () => {
			const result = CrossfireConfigSchema.safeParse(MINIMAL_CONFIG);
			expect(result.success).toBe(true);
		});

		it("accepts valid template with basePreset only", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "strict", basePreset: "guarded" }],
			});
			expect(result.success).toBe(true);
		});

		it("accepts valid template with evidence override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "strict-evidence",
						basePreset: "guarded",
						overrides: { evidence: { bar: "high" } },
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("rejects template with invalid evidence bar", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "bad",
						overrides: { evidence: { bar: "extreme" } },
					},
				],
			});
			expect(result.success).toBe(false);
		});

		it("rejects duplicate template names", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{ name: "t1", basePreset: "guarded" },
					{ name: "t1", basePreset: "research" },
				],
			});
			expect(result.success).toBe(false);
		});

		it("rejects template with invalid basePreset", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "bad", basePreset: "invalid" }],
			});
			expect(result.success).toBe(false);
		});

		it("accepts template with interaction override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "cautious",
						basePreset: "guarded",
						overrides: {
							interaction: { approval: "always", limits: { maxTurns: 5 } },
						},
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("rejects template with invalid approval level", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "bad",
						overrides: { interaction: { approval: "invalid" } },
					},
				],
			});
			expect(result.success).toBe(false);
		});

		it("accepts template with both evidence and interaction overrides", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{
						name: "full",
						basePreset: "research",
						overrides: {
							evidence: { bar: "high" },
							interaction: { approval: "on-risk" },
						},
					},
				],
			});
			expect(result.success).toBe(true);
		});

		it("accepts template with no basePreset (uses role default)", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [
					{ name: "ev-only", overrides: { evidence: { bar: "low" } } },
				],
			});
			expect(result.success).toBe(true);
		});
	});

	describe("role evidence field", () => {
		it("accepts role with evidence override", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				roles: {
					proposer: { binding: "b1", evidence: { bar: "high" } },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(true);
		});

		it("rejects role with invalid evidence bar", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				roles: {
					proposer: { binding: "b1", evidence: { bar: "extreme" } },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(false);
		});
	});

	describe("role template field", () => {
		it("accepts role with template reference", () => {
			const result = CrossfireConfigSchema.safeParse({
				...MINIMAL_CONFIG,
				templates: [{ name: "strict", basePreset: "guarded" }],
				roles: {
					proposer: { binding: "b1", template: "strict" },
					challenger: { binding: "b1" },
				},
			});
			expect(result.success).toBe(true);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/config/schema.test.ts`
Expected: FAIL — `templates` not recognized, `evidence` not recognized, `template` not recognized.

- [ ] **Step 3: Implement schema changes**

In `packages/cli/src/config/schema.ts`:

```typescript
import { z } from "zod";

const PolicyPresetSchema = z.enum(["research", "guarded", "dangerous", "plan"]);

const EvidenceBarSchema = z.enum(["low", "medium", "high"]);

const McpServerConfigSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
});

const ProviderBindingConfigSchema = z.object({
	name: z.string(),
	adapter: z.enum(["claude", "codex", "gemini"]),
	model: z.string().optional(),
	providerOptions: z.record(z.unknown()).optional(),
	mcpServers: z.array(z.string()).optional(),
});

const ApprovalLevelSchema = z.enum(["always", "on-risk", "on-failure", "never"]);

const PolicyTemplateOverridesSchema = z.object({
	evidence: z.object({ bar: EvidenceBarSchema }).optional(),
	interaction: z
		.object({
			approval: ApprovalLevelSchema.optional(),
			limits: z
				.object({
					maxTurns: z.number().int().positive().optional(),
				})
				.optional(),
		})
		.optional(),
});

const PolicyTemplateConfigSchema = z.object({
	name: z.string().min(1),
	basePreset: PolicyPresetSchema.optional(),
	overrides: PolicyTemplateOverridesSchema.optional(),
});

const RoleProfileConfigSchema = z.object({
	binding: z.string(),
	model: z.string().optional(),
	preset: PolicyPresetSchema.optional(),
	template: z.string().optional(),
	evidence: z.object({ bar: EvidenceBarSchema }).optional(),
	systemPrompt: z.string().optional(),
});

export const CrossfireConfigSchema = z
	.object({
		mcpServers: z.record(McpServerConfigSchema).optional(),
		providerBindings: z.array(ProviderBindingConfigSchema),
		templates: z.array(PolicyTemplateConfigSchema).optional(),
		roles: z.object({
			proposer: RoleProfileConfigSchema,
			challenger: RoleProfileConfigSchema,
			judge: RoleProfileConfigSchema.optional(),
		}),
	})
	.superRefine((data, ctx) => {
		if (data.templates) {
			const names = new Set<string>();
			for (let i = 0; i < data.templates.length; i++) {
				const name = data.templates[i].name;
				if (names.has(name)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Duplicate template name: "${name}"`,
						path: ["templates", i, "name"],
					});
				}
				names.add(name);
			}
		}
	});

export type CrossfireConfig = z.infer<typeof CrossfireConfigSchema>;
export type ProviderBindingConfig = z.infer<typeof ProviderBindingConfigSchema>;
export type RoleProfileConfig = z.infer<typeof RoleProfileConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type PolicyTemplateConfig = z.infer<typeof PolicyTemplateConfigSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/config/schema.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

Update `docs/architecture/execution-modes.md` to document the template config schema:

Add a "Custom Templates" section describing the `templates` array in `crossfire.json`, template structure (`name`, `basePreset`, `overrides` with `evidence` and `interaction`), and the unique-name constraint.

```bash
git add packages/cli/src/config/schema.ts packages/cli/__tests__/config/schema.test.ts docs/architecture/execution-modes.md
git commit -m "feat(config): add template and evidence schemas

Add PolicyTemplateConfigSchema with Zod validation for unique names.
Add evidence and interaction override fields to template overrides.
Add evidence field to RoleProfileConfigSchema.
Add template field to RoleProfileConfigSchema.
Add templates array to CrossfireConfigSchema with duplicate-name check.
Update execution-modes docs for template schema."
```

---

## Task 4: Evidence and Template Resolution + CLI Wiring

**Files:**
- Create: `packages/cli/src/config/evidence-resolution.ts`
- Create: `packages/cli/src/config/template-resolution.ts`
- Modify: `packages/cli/src/config/resolver.ts`
- Modify: `packages/cli/src/commands/preset-options.ts`
- Modify: `packages/cli/src/wiring/create-adapters.ts`
- Create: `packages/cli/__tests__/config/evidence-resolution.test.ts`
- Create: `packages/cli/__tests__/config/template-resolution.test.ts`

Add `resolveRoleEvidence()` with its own resolution chain, template expansion in `resolveAllRoles()`, the `--evidence-bar` CLI option, and wiring evidence into `compilePolicyWithDiagnostics` calls.

---

- [ ] **Step 1: Write failing evidence resolution tests**

Create `packages/cli/__tests__/config/evidence-resolution.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	type ResolvedEvidence,
	resolveRoleEvidence,
} from "../../src/config/evidence-resolution.js";

describe("resolveRoleEvidence", () => {
	it("CLI override wins over everything", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			cliEvidenceBar: "low",
			configEvidence: { bar: "high" },
			templateEvidence: { bar: "medium" },
		});
		expect(result).toEqual({ bar: "low", source: "cli" });
	});

	it("config inline wins over template", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			configEvidence: { bar: "high" },
			templateEvidence: { bar: "low" },
		});
		expect(result).toEqual({ bar: "high", source: "config" });
	});

	it("template override wins over role-default", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			templateEvidence: { bar: "low" },
			templateName: "strict",
		});
		expect(result).toEqual({ bar: "low", source: "template:strict" });
	});

	it("falls back to role-default when no override", () => {
		const result = resolveRoleEvidence({ role: "proposer" });
		expect(result).toEqual({ bar: undefined, source: "role-default" });
	});

	it("falls back to role-default when no override for challenger", () => {
		const result = resolveRoleEvidence({ role: "challenger" });
		expect(result).toEqual({ bar: undefined, source: "role-default" });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/config/evidence-resolution.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement evidence-resolution.ts**

Create `packages/cli/src/config/evidence-resolution.ts`:

```typescript
import type { EvidenceBar } from "@crossfire/adapter-core";

export type EvidenceSource =
	| "cli"
	| "config"
	| `template:${string}`
	| "role-default";

export interface ResolvedEvidence {
	bar: EvidenceBar | undefined;
	source: EvidenceSource;
}

export function resolveRoleEvidence(input: {
	role: "proposer" | "challenger" | "judge";
	cliEvidenceBar?: EvidenceBar;
	configEvidence?: { bar?: EvidenceBar };
	templateEvidence?: { bar?: EvidenceBar };
	templateName?: string;
}): ResolvedEvidence {
	if (input.cliEvidenceBar) {
		return { bar: input.cliEvidenceBar, source: "cli" };
	}
	if (input.configEvidence?.bar) {
		return { bar: input.configEvidence.bar, source: "config" };
	}
	if (input.templateEvidence?.bar && input.templateName) {
		return {
			bar: input.templateEvidence.bar,
			source: `template:${input.templateName}`,
		};
	}
	return { bar: undefined, source: "role-default" };
}
```

- [ ] **Step 4: Run evidence resolution tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/config/evidence-resolution.test.ts`
Expected: All PASS.

- [ ] **Step 5: Write failing template resolution tests**

Create `packages/cli/__tests__/config/template-resolution.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveTemplate } from "../../src/config/template-resolution.js";
import type { PolicyTemplateConfig } from "../../src/config/schema.js";

const TEMPLATES: PolicyTemplateConfig[] = [
	{ name: "strict", basePreset: "guarded", overrides: { evidence: { bar: "high" } } },
	{ name: "relaxed", basePreset: "research" },
	{ name: "ev-only", overrides: { evidence: { bar: "low" } } },
];

describe("resolveTemplate", () => {
	it("returns matching template by name", () => {
		const result = resolveTemplate("strict", TEMPLATES);
		expect(result).toEqual(TEMPLATES[0]);
	});

	it("returns undefined for unknown template name", () => {
		const result = resolveTemplate("nonexistent", TEMPLATES);
		expect(result).toBeUndefined();
	});

	it("returns template with no basePreset", () => {
		const result = resolveTemplate("ev-only", TEMPLATES);
		expect(result).toBeDefined();
		expect(result?.basePreset).toBeUndefined();
	});
});
```

- [ ] **Step 6: Implement template-resolution.ts**

Create `packages/cli/src/config/template-resolution.ts`:

```typescript
import type { PolicyTemplateConfig } from "./schema.js";

export function resolveTemplate(
	name: string,
	templates: PolicyTemplateConfig[] | undefined,
): PolicyTemplateConfig | undefined {
	if (!templates) return undefined;
	return templates.find((t) => t.name === name);
}
```

- [ ] **Step 7: Run template resolution tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/config/template-resolution.test.ts`
Expected: All PASS.

- [ ] **Step 8: Update resolver.ts**

In `packages/cli/src/config/resolver.ts`:

Add imports:

```typescript
import type { ApprovalLevel, EvidenceBar, InteractionPolicy } from "@crossfire/adapter-core";
import type { EvidenceSource, ResolvedEvidence } from "./evidence-resolution.js";
import { resolveRoleEvidence } from "./evidence-resolution.js";
import { resolveTemplate } from "./template-resolution.js";
```

Add evidence and interaction overrides to `ResolvedRoleRuntimeConfig`:

```typescript
export interface ResolvedRoleRuntimeConfig {
	role: "proposer" | "challenger" | "judge";
	adapter: AdapterType;
	bindingName: string;
	model?: string;
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	evidence: ResolvedEvidence;
	interactionOverrides?: {
		approval?: ApprovalLevel;
		limits?: { maxTurns?: number };
	};
	templateName?: string;
	systemPrompt?: string;
	providerOptions?: Record<string, unknown>;
	mcpServers?: Record<string, McpServerConfig>;
}
```

Add evidence overrides to `CliPresetOverrides`:

```typescript
export interface CliPresetOverrides {
	cliGlobalPreset?: PolicyPreset;
	cliProposerPreset?: PolicyPreset;
	cliChallengerPreset?: PolicyPreset;
	cliJudgePreset?: PolicyPreset;
	cliEvidenceBar?: EvidenceBar;
}
```

Update `resolveRole` inside `resolveAllRoles` to handle templates and evidence:

```typescript
export function resolveAllRoles(
	config: CrossfireConfig,
	cliOverrides: CliPresetOverrides,
): ResolvedAllRoles {
	const bindingMap = new Map(config.providerBindings.map((b) => [b.name, b]));

	function resolveRole(
		roleName: "proposer" | "challenger" | "judge",
	): ResolvedRoleRuntimeConfig | undefined {
		const roleConfig = config.roles[roleName];
		if (!roleConfig) return undefined;

		const binding = bindingMap.get(roleConfig.binding);
		if (!binding) {
			throw new Error(
				`Role "${roleName}" references binding "${roleConfig.binding}" which does not exist. ` +
					`Available bindings: ${[...bindingMap.keys()].join(", ")}`,
			);
		}

		// Template resolution
		const template = roleConfig.template
			? resolveTemplate(roleConfig.template, config.templates)
			: undefined;
		if (roleConfig.template && !template) {
			throw new Error(
				`Role "${roleName}" references template "${roleConfig.template}" which does not exist. ` +
					`Available templates: ${(config.templates ?? []).map((t) => t.name).join(", ") || "(none)"}`,
			);
		}

		// Preset resolution: template.basePreset takes priority over role preset
		const cliRolePreset =
			roleName === "proposer"
				? cliOverrides.cliProposerPreset
				: roleName === "challenger"
					? cliOverrides.cliChallengerPreset
					: cliOverrides.cliJudgePreset;

		const configOrTemplatePreset = template?.basePreset ?? roleConfig.preset;

		const preset = resolveRolePreset({
			role: roleName,
			configPreset: configOrTemplatePreset,
			cliRolePreset,
			cliGlobalPreset: cliOverrides.cliGlobalPreset,
		});

		// Evidence resolution (independent chain)
		const evidence = resolveRoleEvidence({
			role: roleName,
			cliEvidenceBar: cliOverrides.cliEvidenceBar,
			configEvidence: roleConfig.evidence,
			templateEvidence: template?.overrides?.evidence,
			templateName: template?.name,
		});

		// Interaction overrides from template (approval, limits.maxTurns)
		const interactionOverrides = template?.overrides?.interaction ?? undefined;

		const resolvedMcpServers = binding.mcpServers
			? Object.fromEntries(
					binding.mcpServers.map((name) => {
						const server = config.mcpServers?.[name];
						if (!server) {
							throw new Error(
								`Provider binding "${binding.name}" references MCP server "${name}" which does not exist.`,
							);
						}
						return [name, server];
					}),
				)
			: undefined;

		return {
			role: roleName,
			adapter: binding.adapter,
			bindingName: binding.name,
			model: roleConfig.model ?? binding.model,
			preset: { value: preset.preset, source: preset.source },
			evidence,
			interactionOverrides,
			templateName: template?.name,
			systemPrompt: roleConfig.systemPrompt,
			providerOptions: binding.providerOptions,
			mcpServers: resolvedMcpServers,
		};
	}

	const proposer = resolveRole("proposer");
	const challenger = resolveRole("challenger");
	if (!proposer || !challenger) {
		throw new Error("proposer and challenger roles are required");
	}

	return {
		proposer,
		challenger,
		judge: resolveRole("judge"),
	};
}
```

- [ ] **Step 9: Add --evidence-bar CLI option**

In `packages/cli/src/commands/preset-options.ts`:

Add imports and parsing:

```typescript
import type { EvidenceBar, PolicyPreset } from "@crossfire/adapter-core";

const VALID_EVIDENCE_BARS = new Set<EvidenceBar>(["low", "medium", "high"]);

export function parseEvidenceBarValue(
	value: string,
	label: string,
): EvidenceBar {
	if (VALID_EVIDENCE_BARS.has(value as EvidenceBar)) {
		return value as EvidenceBar;
	}
	throw new Error(`${label} must be one of: low, medium, high`);
}
```

Update `PresetConfig`:

```typescript
export interface PresetConfig {
	globalPreset?: PolicyPreset;
	rolePresets?: Partial<
		Record<"proposer" | "challenger" | "judge", PolicyPreset>
	>;
	turnPresets?: Record<string, PolicyPreset>;
	evidenceBar?: EvidenceBar;
}
```

Update `buildPresetConfig`:

```typescript
export function buildPresetConfig(options: {
	preset?: string;
	proposerPreset?: string;
	challengerPreset?: string;
	judgePreset?: string;
	turnPreset?: string[];
	evidenceBar?: string;
}): PresetConfig | undefined {
	const globalPreset = options.preset
		? parsePresetValue(options.preset, "--preset")
		: undefined;
	const proposerPreset = options.proposerPreset
		? parsePresetValue(options.proposerPreset, "--proposer-preset")
		: undefined;
	const challengerPreset = options.challengerPreset
		? parsePresetValue(options.challengerPreset, "--challenger-preset")
		: undefined;
	const judgePreset = options.judgePreset
		? parsePresetValue(options.judgePreset, "--judge-preset")
		: undefined;
	const turnPresets = options.turnPreset?.length
		? parseTurnPresets(options.turnPreset)
		: undefined;
	const evidenceBar = options.evidenceBar
		? parseEvidenceBarValue(options.evidenceBar, "--evidence-bar")
		: undefined;

	if (
		!globalPreset &&
		!proposerPreset &&
		!challengerPreset &&
		!judgePreset &&
		!turnPresets &&
		!evidenceBar
	) {
		return undefined;
	}

	return {
		...(globalPreset ? { globalPreset } : {}),
		...(proposerPreset || challengerPreset || judgePreset
			? {
					rolePresets: {
						...(proposerPreset ? { proposer: proposerPreset } : {}),
						...(challengerPreset ? { challenger: challengerPreset } : {}),
						...(judgePreset ? { judge: judgePreset } : {}),
					},
				}
			: {}),
		...(turnPresets ? { turnPresets } : {}),
		...(evidenceBar ? { evidenceBar } : {}),
	};
}
```

Update `toCliPresetOverrides`:

```typescript
export function toCliPresetOverrides(
	presetConfig?: PresetConfig,
): CliPresetOverrides {
	return {
		...(presetConfig?.globalPreset
			? { cliGlobalPreset: presetConfig.globalPreset }
			: {}),
		...(presetConfig?.rolePresets?.proposer
			? { cliProposerPreset: presetConfig.rolePresets.proposer }
			: {}),
		...(presetConfig?.rolePresets?.challenger
			? { cliChallengerPreset: presetConfig.rolePresets.challenger }
			: {}),
		...(presetConfig?.rolePresets?.judge
			? { cliJudgePreset: presetConfig.rolePresets.judge }
			: {}),
		...(presetConfig?.evidenceBar
			? { cliEvidenceBar: presetConfig.evidenceBar }
			: {}),
	};
}
```

- [ ] **Step 10: Wire evidence into create-adapters.ts**

In `packages/cli/src/wiring/create-adapters.ts`, update `startResolvedRole` to pass evidence and interaction overrides:

```typescript
async function startResolvedRole(resolved: ResolvedRoleRuntimeConfig) {
	const diagnostics = compilePolicyWithDiagnostics({
		preset: resolved.preset.value,
		role: resolved.role,
		...(resolved.evidence.bar !== undefined
			? { evidenceOverride: { bar: resolved.evidence.bar } }
			: {}),
		...(resolved.interactionOverrides
			? { interactionOverride: resolved.interactionOverrides }
			: {}),
	});
	// ... rest unchanged
```

- [ ] **Step 11: Build and run all tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm test`
Expected: All PASS. Full monorepo builds and tests pass.

- [ ] **Step 12: Update docs and README**

Update `docs/architecture/execution-modes.md` to add an "Evidence Policy" section describing the evidence resolution chain (CLI --evidence-bar > config inline > template override > role-contract default), default values per role, and the `approximate` adapter warning contract.

Update `docs/architecture/tui-cli.md` to document `--evidence-bar` CLI option.

Update `README.md` and `README.zh-CN.md` to document:
- The `--evidence-bar` CLI option under the CLI usage section
- Template config under the configuration section
- A brief mention of evidence policy as a configurable dimension

- [ ] **Step 13: Commit**

```bash
git add packages/cli/src/config/evidence-resolution.ts packages/cli/src/config/template-resolution.ts packages/cli/src/config/resolver.ts packages/cli/src/commands/preset-options.ts packages/cli/src/wiring/create-adapters.ts packages/cli/__tests__/config/evidence-resolution.test.ts packages/cli/__tests__/config/template-resolution.test.ts docs/architecture/execution-modes.md docs/architecture/tui-cli.md README.md README.zh-CN.md
git commit -m "feat(cli): add evidence resolution, template expansion, --evidence-bar

Add resolveRoleEvidence() with independent resolution chain:
CLI > config inline > template override > role-default.
Add resolveTemplate() for flat template lookup.
Wire evidence and interaction overrides into compilePolicyWithDiagnostics.
Add --evidence-bar CLI option.
Update architecture docs and READMEs for evidence/template features."
```

---

## Task 5: Evidence Provenance in Events and TUI State

**Files:**
- Modify: `packages/adapter-core/src/policy/observation-types.ts` — Add `EvidenceSource` type export
- Modify: `packages/orchestrator-core/src/orchestrator-events.ts` — Add evidence provenance to `PolicyBaselineEvent` and `RuntimePolicyState`
- Modify: `packages/orchestrator/src/runner.ts` — Pass evidence provenance through baseline emission
- Modify: `packages/tui/src/state/tui-store.ts` — Project evidence source into session state (if store handles policy events)
- Test: `packages/orchestrator/__tests__/policy-runner.test.ts` — Add evidence provenance test

---

- [ ] **Step 1: Write failing test for evidence provenance in baseline event**

In `packages/orchestrator/__tests__/policy-runner.test.ts`, add a test that checks `policy.baseline` events carry evidence **provenance** (the `evidence.source` field on the event itself, not just `policy.evidence`):

```typescript
it("policy.baseline event carries evidence provenance source", async () => {
	// Use existing test setup pattern from the file.
	// Configure adapters with baselineEvidenceSource set.
	const events: OrchestratorEvent[] = [];
	bus.subscribe((e) => {
		if ("kind" in e && typeof e.kind === "string") events.push(e as OrchestratorEvent);
	});

	// Set evidence source on adapter entries
	adapters.proposer.baselineEvidenceSource = "config";
	adapters.challenger.baselineEvidenceSource = "role-default";

	await runDebate(bus, adapters, config);

	const baselineEvents = events.filter(
		(e): e is PolicyBaselineEvent => e.kind === "policy.baseline",
	);
	expect(baselineEvents.length).toBeGreaterThan(0);

	const proposerBaseline = baselineEvents.find((e) => e.role === "proposer");
	expect(proposerBaseline?.evidence).toBeDefined();
	expect(proposerBaseline?.evidence?.source).toBe("config");

	const challengerBaseline = baselineEvents.find((e) => e.role === "challenger");
	expect(challengerBaseline?.evidence).toBeDefined();
	expect(challengerBaseline?.evidence?.source).toBe("role-default");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm vitest run packages/orchestrator/__tests__/policy-runner.test.ts`
Expected: FAIL — `baselineEvidenceSource` does not exist on the adapter entry type yet, and `evidence` field does not exist on `PolicyBaselineEvent`.

- [ ] **Step 3: Add EvidenceSource to observation-types.ts**

In `packages/adapter-core/src/policy/observation-types.ts`, add after the existing `PresetSource`:

```typescript
/**
 * Evidence source provenance — independent from PresetSource.
 */
export type EvidenceSource =
	| "cli"
	| "config"
	| `template:${string}`
	| "role-default";
```

- [ ] **Step 4: Add evidence provenance to orchestrator events**

In `packages/orchestrator-core/src/orchestrator-events.ts`, update `PolicyBaselineEvent`:

```typescript
export interface PolicyBaselineEvent {
	kind: "policy.baseline";
	role: "proposer" | "challenger" | "judge";
	policy: ResolvedPolicy;
	clamps: PolicyClampNote[];
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	evidence?: {
		source: EvidenceSource;
	};
	translationSummary: PolicyTranslationSummary;
	warnings: PolicyTranslationWarning[];
	observation: ProviderObservationResult;
	timestamp: number;
}
```

Add import for `EvidenceSource`:

```typescript
import type {
	// ... existing imports
	EvidenceSource,
} from "@crossfire/adapter-core";
```

Update `RuntimePolicyState.baseline` to include evidence source:

```typescript
export interface RuntimePolicyState {
	baseline: {
		policy: ResolvedPolicy;
		clamps: PolicyClampNote[];
		preset: {
			value: PolicyPreset;
			source: PresetSource;
		};
		evidence?: {
			source: EvidenceSource;
		};
		translationSummary: PolicyTranslationSummary;
		warnings: PolicyTranslationWarning[];
		observation: ProviderObservationResult;
	};
	currentTurnOverride?: {
		turnId: string;
		policy: ResolvedPolicy;
		preset: PolicyPreset;
		translationSummary: PolicyTranslationSummary;
		warnings: PolicyTranslationWarning[];
		observation: ProviderObservationResult;
	};
}
```

- [ ] **Step 5: Update AdapterMap and runner to carry evidence provenance**

In `packages/orchestrator/src/runner.ts`, add to the `AdapterMap` entry type (for all three roles):

```typescript
baselineEvidenceSource?: EvidenceSource;
```

Add `EvidenceSource` to imports:

```typescript
import type { EvidenceSource } from "@crossfire/adapter-core";
```

Update `emitBaselinePolicyEvents` to include evidence provenance:

```typescript
function emitBaselinePolicyEvents(
	bus: DebateEventBus,
	adapters: AdapterMap,
): void {
	for (const role of ["proposer", "challenger", "judge"] as const) {
		const entry = adapters[role];
		if (!entry?.baselinePolicy || !entry.baselinePreset) continue;
		const observation = getObservationForPolicy(entry, entry.baselinePolicy);
		const fallbackObservation: ProviderObservationResult = {
			translation: {
				adapter: entry.session.adapterId ?? "unknown",
				nativeSummary: {},
				exactFields: [],
				approximateFields: [],
				unsupportedFields: [],
			},
			toolView: [],
			capabilityEffects: [],
			warnings: [],
			completeness: "minimal",
		};
		bus.push({
			kind: "policy.baseline",
			role,
			policy: entry.baselinePolicy,
			clamps: [...(entry.baselineClamps ?? [])],
			preset: entry.baselinePreset,
			...(entry.baselineEvidenceSource
				? { evidence: { source: entry.baselineEvidenceSource } }
				: {}),
			translationSummary:
				observation?.translation ?? fallbackObservation.translation,
			warnings: [...(observation?.warnings ?? [])],
			observation: observation ?? fallbackObservation,
			timestamp: Date.now(),
		});
	}
}
```

- [ ] **Step 6: Wire evidence source from create-adapters.ts**

In `packages/cli/src/wiring/create-adapters.ts`, add evidence source to the returned adapter entry:

```typescript
return {
	adapter,
	session,
	baselinePolicy: policy,
	baselineClamps: diagnostics.clamps,
	baselinePreset: resolved.preset,
	baselineObservation: observation,
	baselineEvidenceSource: resolved.evidence.source,
	legacyToolPolicyInput: undefined,
	observePolicy: (nextPolicy: ResolvedPolicy): ProviderObservationResult =>
		observePolicyForAdapter(
			resolved.adapter,
			nextPolicy,
			resolved.mcpServers,
		),
};
```

Import `EvidenceSource` if needed:

```typescript
import type { EvidenceSource } from "@crossfire/adapter-core";
```

- [ ] **Step 7: Update TUI store to project evidence source**

In `packages/tui/src/state/tui-store.ts`, find where `policy.baseline` events are handled and ensure `evidence` is projected into `RuntimePolicyState`:

When projecting baseline events, include the evidence field:

```typescript
// In the policy.baseline handler, ensure evidence is passed through:
baseline: {
	policy: event.policy,
	clamps: event.clamps,
	preset: event.preset,
	evidence: event.evidence,
	translationSummary: event.translationSummary,
	warnings: event.warnings,
	observation: event.observation,
},
```

- [ ] **Step 8: Build and run all tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm test`
Expected: All PASS. Evidence provenance flows through the full pipeline.

- [ ] **Step 9: Commit**

```bash
git add packages/adapter-core/src/policy/observation-types.ts packages/orchestrator-core/src/orchestrator-events.ts packages/orchestrator/src/runner.ts packages/cli/src/wiring/create-adapters.ts packages/tui/src/state/tui-store.ts packages/orchestrator/__tests__/policy-runner.test.ts
git commit -m "feat(events): add evidence provenance to policy events

Add EvidenceSource type to observation-types.
PolicyBaselineEvent and RuntimePolicyState now carry evidence source.
Runner emits evidence provenance from adapter wiring.
TUI store projects evidence source into session state."
```

---

## Task 6: Inspection Surface Updates

**Files:**
- Modify: `packages/cli/src/commands/inspection-context.ts` — Add evidence provenance
- Modify: `packages/cli/src/commands/inspection-renderers.ts` — Add evidence display
- Modify: `packages/cli/src/commands/inspection-reports.ts` — Add evidence to JSON
- Test: `packages/cli/__tests__/commands/inspection-renderers.test.ts`

---

- [ ] **Step 1: Write failing test for evidence in inspection text output**

Add to (or create) `packages/cli/__tests__/commands/inspection-renderers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { RoleInspectionContext } from "../../src/commands/inspection-context.js";
import { renderPolicyText } from "../../src/commands/inspection-renderers.js";
import { makeResolvedPolicy, makeWarning } from "@crossfire/adapter-core";

function makeInspectionContext(
	overrides: Partial<RoleInspectionContext> = {},
): RoleInspectionContext {
	const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
	return {
		role: "proposer",
		adapter: "claude",
		model: "test-model",
		preset: { value: "guarded", source: "config" },
		resolvedPolicy: policy,
		clamps: [],
		observation: {
			translation: {
				adapter: "claude",
				nativeSummary: {},
				exactFields: [],
				approximateFields: [],
				unsupportedFields: [],
			},
			toolView: [],
			capabilityEffects: [],
			warnings: [],
			completeness: "full",
		},
		...overrides,
	} as RoleInspectionContext;
}

describe("renderPolicyText", () => {
	it("includes evidence section with bar and source", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: "high", source: "config" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("bar: high");
		expect(output).toContain("(config)");
	});

	it("shows role-default evidence when no explicit override", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: undefined, source: "role-default" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("(role-default)");
	});

	it("shows template evidence source", () => {
		const ctx = makeInspectionContext({
			evidence: { bar: "low", source: "template:strict" },
		});
		const output = renderPolicyText([ctx]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("template:strict");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/cli/__tests__/commands/inspection-renderers.test.ts`
Expected: FAIL — `evidence` property not on `RoleInspectionContext`, renderer doesn't output evidence section.

- [ ] **Step 3: Add evidence to inspection-context.ts**

In `packages/cli/src/commands/inspection-context.ts`:

Add import:

```typescript
import type { EvidenceSource } from "../config/evidence-resolution.js";
```

Add evidence to `RoleInspectionBase`:

```typescript
interface RoleInspectionBase {
	role: "proposer" | "challenger" | "judge";
	adapter: string;
	model?: string;
	preset: {
		value: PolicyPreset;
		source: PresetSource;
	};
	evidence?: {
		bar: EvidenceBar | undefined;
		source: EvidenceSource;
	};
}
```

Add import for `EvidenceBar`:

```typescript
import type {
	// ... existing
	EvidenceBar,
} from "@crossfire/adapter-core";
```

In `buildInspectionContext`, pass evidence from resolved roles:

```typescript
results.push({
	role: roleName,
	adapter: resolved.adapter,
	model: resolved.model,
	preset: resolved.preset,
	evidence: resolved.evidence,
	resolvedPolicy: diagnostics.policy,
	clamps: diagnostics.clamps,
	observation,
});
```

And in the error path:

```typescript
results.push({
	role: roleName,
	adapter: resolved.adapter,
	model: resolved.model,
	preset: resolved.preset,
	evidence: resolved.evidence,
	error: {
		message: err instanceof Error ? err.message : String(err),
	},
});
```

- [ ] **Step 4: Add evidence display to inspection-renderers.ts**

In `packages/cli/src/commands/inspection-renderers.ts`, add evidence section in `renderPolicyText`:

```typescript
export function renderPolicyText(contexts: RoleInspectionContext[]): string {
	const lines: string[] = [];
	for (const ctx of contexts) {
		if (ctx.error) {
			lines.push(`\n[${ctx.role}] ERROR: ${ctx.error.message}`);
			continue;
		}
		lines.push(`\n=== ${ctx.role} (${ctx.adapter}) ===`);
		lines.push(`  Preset: ${ctx.preset.value} (${ctx.preset.source})`);
		lines.push(`  Model: ${ctx.model ?? "(default)"}`);

		// Evidence section
		if (ctx.evidence) {
			const barDisplay = ctx.evidence.bar ?? "(role-default)";
			lines.push(`  Evidence:`);
			lines.push(`    bar: ${barDisplay} (${ctx.evidence.source})`);
		}

		if (ctx.clamps.length > 0) {
			lines.push("  Clamps:");
			for (const c of ctx.clamps) {
				lines.push(`    ${c.field}: ${c.before} → ${c.after} (${c.reason})`);
			}
		}
		if (ctx.observation.warnings.length > 0) {
			lines.push("  Warnings:");
			for (const w of ctx.observation.warnings) {
				lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
			}
		}
		const t = ctx.observation.translation;
		lines.push(`  Translation: ${JSON.stringify(t.nativeSummary)}`);
	}
	return lines.join("\n");
}
```

- [ ] **Step 5: Add evidence to inspection-reports.ts JSON output**

In `packages/cli/src/commands/inspection-reports.ts`:

Add to `RolePolicyInspection`:

```typescript
export interface RolePolicyInspection {
	role: "proposer" | "challenger" | "judge";
	adapter: string;
	model?: string;
	preset: PresetSelection;
	evidence?: {
		bar: string | undefined;
		source: string;
	};
	resolvedPolicy?: ResolvedPolicy;
	clamps?: readonly PolicyClampNote[];
	translation?: PolicyTranslationSummary;
	warnings?: readonly PolicyTranslationWarning[];
	error?: InspectionError;
}
```

Update `buildPolicyInspectionReport` to include evidence:

```typescript
return {
	role: ctx.role,
	adapter: ctx.adapter,
	model: ctx.model,
	preset: ctx.preset,
	evidence: ctx.evidence,
	resolvedPolicy: ctx.resolvedPolicy,
	clamps: ctx.clamps,
	translation: ctx.observation.translation,
	warnings: ctx.observation.warnings,
};
```

And the error path:

```typescript
return {
	role: ctx.role,
	adapter: ctx.adapter,
	model: ctx.model,
	preset: ctx.preset,
	evidence: ctx.evidence,
	error: ctx.error,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm vitest run packages/cli/__tests__/commands/inspection-renderers.test.ts`
Expected: All PASS.

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/jyzhan/code/crossfire && pnpm test`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/inspection-context.ts packages/cli/src/commands/inspection-renderers.ts packages/cli/src/commands/inspection-reports.ts packages/cli/__tests__/commands/inspection-renderers.test.ts
git commit -m "feat(inspection): add evidence provenance to inspect output

Inspection text output shows evidence bar and source per role.
JSON inspection report includes evidence field.
Evidence provenance flows from resolver through inspection context."
```

---

## Task 7: Status Surface Updates and Documentation

**Files:**
- Modify: `packages/tui/src/status/status-renderers.ts` — Replace forward-compatible cast with typed access
- Modify: `packages/tui/src/status/status-view-models.ts` — Add evidence source to view model
- Modify: `docs/architecture/orchestrator.md` — Evidence in policy events
- Modify: `docs/architecture/tui-cli.md` — Evidence in inspection + status
- Modify: `docs/architecture/execution-modes.md` — Evidence section, templates
- Test: `packages/tui/__tests__/status/status-renderers.test.ts`

---

- [ ] **Step 1: Write failing test for evidence in status renderer**

Add to (or create) `packages/tui/__tests__/status/status-renderers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	buildStatusPolicyView,
	renderStatusPolicy,
} from "../../src/status/index.js";
import type { RuntimePolicyState } from "@crossfire/orchestrator-core";
import { makeResolvedPolicy } from "@crossfire/adapter-core";

function makeRuntimeState(
	overrides: Partial<RuntimePolicyState["baseline"]> = {},
): RuntimePolicyState {
	const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
	return {
		baseline: {
			policy,
			clamps: [],
			preset: { value: "guarded", source: "config" },
			translationSummary: {
				adapter: "claude",
				nativeSummary: {},
				exactFields: [],
				approximateFields: [],
				unsupportedFields: [],
			},
			warnings: [],
			observation: {
				translation: {
					adapter: "claude",
					nativeSummary: {},
					exactFields: [],
					approximateFields: [],
					unsupportedFields: [],
				},
				toolView: [],
				capabilityEffects: [],
				warnings: [],
				completeness: "full",
			},
			...overrides,
		},
	};
}

describe("status renderers evidence", () => {
	it("renderStatusPolicy shows evidence section from ResolvedPolicy", () => {
		const state = makeRuntimeState();
		const view = buildStatusPolicyView("proposer", "claude", "test-model", state);
		const output = renderStatusPolicy([view]);
		expect(output).toContain("Evidence:");
		expect(output).toContain("bar:");
	});

	it("renderStatusPolicy shows evidence source when available", () => {
		const state = makeRuntimeState({
			evidence: { source: "config" },
		});
		const view = buildStatusPolicyView("proposer", "claude", "test-model", state);
		const output = renderStatusPolicy([view]);
		expect(output).toContain("Evidence:");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyzhan/code/crossfire && pnpm vitest run packages/tui/__tests__/status/status-renderers.test.ts`
Expected: May partially pass since status-renderers.ts already has forward-compatible evidence rendering via cast. But the evidence source provenance test should fail.

- [ ] **Step 3: Update status-view-models.ts**

In `packages/tui/src/status/status-view-models.ts`:

Add import:

```typescript
import type { EvidenceSource } from "@crossfire/adapter-core";
```

Add evidence source to `StatusPolicyView.baseline`:

```typescript
export interface StatusPolicyView {
	role: string;
	adapter: string;
	model: string;
	baseline: {
		preset: { value: PolicyPreset; source: PresetSource };
		policy: ResolvedPolicy;
		clamps: readonly PolicyClampNote[];
		translationSummary: PolicyTranslationSummary;
		warnings: readonly PolicyTranslationWarning[];
		evidenceSource?: EvidenceSource;
	};
	override?: {
		turnId: string;
		preset: PolicyPreset;
		policy: ResolvedPolicy;
		translationSummary: PolicyTranslationSummary;
		warnings: readonly PolicyTranslationWarning[];
	};
}
```

Update `buildStatusPolicyView` to include evidence source:

```typescript
export function buildStatusPolicyView(
	role: string,
	adapter: string,
	model: string,
	state: RuntimePolicyState,
): StatusPolicyView {
	const view: StatusPolicyView = {
		role,
		adapter,
		model,
		baseline: {
			preset: state.baseline.preset,
			policy: state.baseline.policy,
			clamps: state.baseline.clamps,
			translationSummary: state.baseline.translationSummary,
			warnings: state.baseline.warnings,
			evidenceSource: state.baseline.evidence?.source,
		},
	};
	if (state.currentTurnOverride) {
		view.override = {
			turnId: state.currentTurnOverride.turnId,
			preset: state.currentTurnOverride.preset,
			policy: state.currentTurnOverride.policy,
			translationSummary: state.currentTurnOverride.translationSummary,
			warnings: state.currentTurnOverride.warnings,
		};
	}
	return view;
}
```

- [ ] **Step 4: Update status-renderers.ts — replace forward-compatible cast**

In `packages/tui/src/status/status-renderers.ts`, replace the forward-compatible cast block in `renderPolicySummary`:

```typescript
function renderPolicySummary(policy: ResolvedPolicy): string[] {
	const lines: string[] = [];
	const caps = policy.capabilities;
	if (caps) {
		const entries = Object.entries(caps).filter(([, v]) => v !== undefined);
		if (entries.length > 0) {
			lines.push("  Capabilities:");
			for (const [k, v] of entries) {
				lines.push(`    ${k}: ${String(v)}`);
			}
		}
	}
	const interaction = policy.interaction;
	if (interaction) {
		const entries = Object.entries(interaction).filter(
			([, v]) => v !== undefined,
		);
		if (entries.length > 0) {
			lines.push("  Interaction:");
			for (const [k, v] of entries) {
				lines.push(`    ${k}: ${JSON.stringify(v)}`);
			}
		}
	}
	if (policy.evidence) {
		lines.push("  Evidence:");
		lines.push(`    bar: ${policy.evidence.bar}`);
	}
	return lines;
}
```

In `renderStatusPolicy`, add evidence source display after the evidence section from policy:

```typescript
lines.push(...renderPolicySummary(view.baseline.policy));

if (view.baseline.evidenceSource) {
	lines.push(`  Evidence Source: ${view.baseline.evidenceSource}`);
}
```

- [ ] **Step 5: Run status tests**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm vitest run packages/tui/__tests__/status`
Expected: All PASS.

- [ ] **Step 6: Update remaining documentation**

Earlier tasks already updated:
- `docs/architecture/orchestrator.md` (Task 1: ResolvedPolicy shape; Task 5: evidence provenance in events)
- `docs/architecture/execution-modes.md` (Task 3: template schema; Task 4: evidence resolution chain)
- `docs/architecture/tui-cli.md` (Task 4: --evidence-bar CLI; Task 6: inspection evidence display)
- `README.md` and `README.zh-CN.md` (Task 4: evidence-bar CLI + template config)

In this task, update the remaining status-specific documentation:

Update `docs/architecture/tui-cli.md` to mention that `/status policy` now shows typed evidence with provenance source, and that the forward-compatible cast has been replaced with real typed access.

Verify all architecture docs are consistent with the final implementation. Check that template examples in `execution-modes.md` include both `evidence` and `interaction` overrides:

```json
{
  "templates": [
    {
      "name": "strict",
      "basePreset": "guarded",
      "overrides": {
        "evidence": { "bar": "high" },
        "interaction": { "approval": "always", "limits": { "maxTurns": 5 } }
      }
    }
  ]
}
```

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/jyzhan/code/crossfire && pnpm build && pnpm test`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/status/status-renderers.ts packages/tui/src/status/status-view-models.ts packages/tui/__tests__/status docs/architecture/orchestrator.md docs/architecture/tui-cli.md docs/architecture/execution-modes.md
git commit -m "feat(status): typed evidence in status + documentation

Replace forward-compatible evidence cast with typed ResolvedPolicy access.
Add evidence source provenance to StatusPolicyView.
Update architecture docs for evidence pipeline and custom templates."
```

---

## Self-Review Checklist

**1. Spec coverage:**
- Evidence policy independence (promote to ResolvedPolicy): Task 1
- Evidence configurable via config/templates/CLI: Task 3 + Task 4
- Evidence adapter translation with warnings: Task 2
- Custom templates (flat, named, Zod validation, unique names): Task 3
- Template preset + evidence resolution: Task 4
- Evidence provenance in events: Task 5
- Inspection surface updates: Task 6
- Status surface updates: Task 7
- Documentation: distributed across tasks (Task 1: orchestrator.md, Task 3: execution-modes.md, Task 4: execution-modes.md + tui-cli.md + READMEs, Task 5: orchestrator.md, Task 6: tui-cli.md, Task 7: remaining)

**2. Placeholder scan:** No TBD/TODO/placeholders found.

**3. Type consistency:**
- `EvidencePolicy = { readonly bar: EvidenceBar }` — used consistently in types.ts, compiler.ts, renderers
- `EvidenceSource` — defined in `observation-types.ts`, re-defined in `evidence-resolution.ts` (CLI scope), used in events and view models
- `ResolvedEvidence = { bar: EvidenceBar | undefined, source: EvidenceSource }` — used in resolver and inspection context
- `evidenceOverride` on `CompilePolicyInput` — used in compiler, policy-fixtures, create-adapters
- `interactionOverride` on `CompilePolicyInput` — used in compiler, policy-fixtures, create-adapters
- `PolicyTemplateConfig` — defined in schema.ts, used in template-resolution.ts; includes both `evidence` and `interaction` overrides
- `makeCompileInput` accepts `evidenceOverride` and `interactionOverride` — consistent with `CompilePolicyInput`
- Template precedence: `template.basePreset` wins over `roleConfig.preset` — consistent with spec
- Warning contract: all adapters use `approximate` for `evidence.bar` — consistent with spec (influences prompting only)
