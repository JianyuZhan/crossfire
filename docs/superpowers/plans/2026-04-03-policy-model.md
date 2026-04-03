# Policy Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Crossfire's provider-first mode mapping with a policy-first compilation architecture where presets expand to provider-agnostic policies that adapters translate to native parameters.

**Architecture:** New `policy/` module in `adapter-core` defines types, presets, role contracts, and a pure compiler. Each adapter implements `translatePolicy()` as a pure function producing provider-native options + structured warnings. Existing CLI/profile shell unchanged; old `executionMode` path kept as deprecated fallback.

**Tech Stack:** TypeScript, Vitest, Zod (existing), pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-04-03-policy-model-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `packages/adapter-core/src/policy/types.ts` | All policy type definitions (CapabilityPolicy, RoleContract, InteractionPolicy, ResolvedPolicy, etc.) |
| `packages/adapter-core/src/policy/level-order.ts` | Ordered enum helpers for capability clamping |
| `packages/adapter-core/src/policy/role-contracts.ts` | 3 default frozen RoleContract constants |
| `packages/adapter-core/src/policy/presets.ts` | 4 preset expansion table |
| `packages/adapter-core/src/policy/compiler.ts` | `compilePolicy()` pure function |
| `packages/adapter-core/src/policy/index.ts` | Barrel export for policy module |
| `packages/adapter-core/__tests__/policy/level-order.test.ts` | Level-order helper tests |
| `packages/adapter-core/__tests__/policy/role-contracts.test.ts` | Role contract snapshot tests |
| `packages/adapter-core/__tests__/policy/presets.test.ts` | Preset expansion snapshot tests |
| `packages/adapter-core/__tests__/policy/compiler.test.ts` | 12-combo compiler tests + legacy overrides + immutability |
| `packages/adapter-claude/src/policy-translation.ts` | `translatePolicy()` for Claude |
| `packages/adapter-claude/__tests__/policy-translation.test.ts` | Claude translation tests |
| `packages/adapter-codex/src/policy-translation.ts` | `translatePolicy()` for Codex |
| `packages/adapter-codex/__tests__/policy-translation.test.ts` | Codex translation tests |
| `packages/adapter-gemini/src/policy-translation.ts` | `translatePolicy()` for Gemini |
| `packages/adapter-gemini/__tests__/policy-translation.test.ts` | Gemini translation tests |

### Modified files

| File | Change |
|---|---|
| `packages/adapter-core/src/index.ts` | Add `export * from "./policy/index.js"` |
| `packages/adapter-core/src/types.ts` | Add `policy?: ResolvedPolicy` to `StartSessionInput` and `TurnInput`; deprecate `RoleExecutionMode`, `TurnExecutionMode` |
| `packages/adapter-claude/src/claude-adapter.ts` | `startSession`/`sendTurn` gain policy path + fallback |
| `packages/adapter-codex/src/codex-adapter.ts` | Same pattern |
| `packages/adapter-gemini/src/gemini-adapter.ts` | Same pattern |
| `packages/cli/src/wiring/create-adapters.ts` | Call `compilePolicy()`, store baseline on adapter entries |
| `packages/orchestrator/src/runner.ts` | `AdapterMap` type gains `baselinePolicy`/`legacyToolPolicyInput`; compile per-turn policies |
| `packages/orchestrator/src/judge.ts` | Remove `executionMode: "plan"` hardcode |
| `packages/orchestrator-core/src/execution-modes.ts` | Thin compat wrapper delegating to `compilePolicy()` |
| `docs/architecture/adapter-layer.md` | Document policy compilation flow |
| `docs/architecture/execution-modes.md` | Document policy model, remove old research->dontAsk mapping |

---

## Task 1: Policy Types

**Files:**
- Create: `packages/adapter-core/src/policy/types.ts`
- Test: `packages/adapter-core/__tests__/policy/level-order.test.ts` (type import verification only)

- [ ] **Step 1: Create types file**

```typescript
// packages/adapter-core/src/policy/types.ts
import type { AdapterId, DebateRole } from "../types.js";

// --- Capability levels (ordered enums, NOT comparable as strings) ---

export type FilesystemLevel = "off" | "read" | "write";
export type NetworkLevel = "off" | "search" | "fetch" | "full";
export type ShellLevel = "off" | "readonly" | "exec";
export type SubagentLevel = "off" | "on";

export type CapabilityPolicy = {
	readonly filesystem: FilesystemLevel;
	readonly network: NetworkLevel;
	readonly shell: ShellLevel;
	readonly subagents: SubagentLevel;
	readonly legacyToolOverrides?: {
		readonly allow?: readonly string[];
		readonly deny?: readonly string[];
		readonly source: "legacy-profile";
	};
};

// --- Role contract ---

export type ExplorationLevel = "forbidden" | "allowed" | "preferred";
export type FactCheckLevel = "none" | "minimal" | "allowed";
export type EvidenceBar = "low" | "medium" | "high";

export type RoleSemantics = {
	readonly exploration: ExplorationLevel;
	readonly factCheck: FactCheckLevel;
	readonly mayIntroduceNewProposal: boolean;
	readonly evidenceBar: EvidenceBar;
};

export type CapabilityCeilings = Partial<
	Readonly<Omit<CapabilityPolicy, "legacyToolOverrides">>
>;

export type RoleContract = {
	readonly semantics: RoleSemantics;
	readonly ceilings: CapabilityCeilings;
};

// --- Interaction policy ---

export type ApprovalLevel = "always" | "on-risk" | "on-failure" | "never";

export type ExecutionLimits = {
	readonly maxTurns?: number;
	readonly maxToolCalls?: number;
	readonly timeoutMs?: number;
	readonly budgetUsd?: number;
};

export type InteractionPolicy = {
	readonly approval: ApprovalLevel;
	readonly limits?: Readonly<ExecutionLimits>;
};

// --- Resolved policy ---

export type PolicyPreset = "research" | "guarded" | "dangerous" | "plan";

export type ResolvedPolicy = {
	readonly preset: PolicyPreset;
	readonly roleContract: RoleContract;
	readonly capabilities: CapabilityPolicy;
	readonly interaction: InteractionPolicy;
};

// --- Compiler input ---

export type LegacyToolPolicyInput = {
	readonly allow?: readonly string[];
	readonly deny?: readonly string[];
};

export type CompilePolicyInput = {
	readonly preset: PolicyPreset;
	readonly role: DebateRole;
	readonly legacyToolPolicy?: LegacyToolPolicyInput;
};

// --- Translation result ---

export type PolicyTranslationWarning = {
	readonly field: string;
	readonly adapter: AdapterId;
	readonly reason: "unsupported" | "approximate" | "not_implemented";
	readonly message: string;
};

export type ProviderTranslationResult<TNative> = {
	readonly native: TNative;
	readonly warnings: readonly PolicyTranslationWarning[];
};
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @crossfire/adapter-core exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/adapter-core/src/policy/types.ts
git commit -m "feat(adapter-core): add policy model type definitions"
```

---

## Task 2: Level-Order Helpers

**Files:**
- Create: `packages/adapter-core/src/policy/level-order.ts`
- Create: `packages/adapter-core/__tests__/policy/level-order.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/adapter-core/__tests__/policy/level-order.test.ts
import { describe, expect, it } from "vitest";
import {
	clampFilesystem,
	clampNetwork,
	clampShell,
	clampSubagents,
} from "../../src/policy/level-order.js";

describe("clampFilesystem", () => {
	it("returns base when no ceiling", () => {
		expect(clampFilesystem("write", undefined)).toBe("write");
	});
	it("returns base when base <= ceiling", () => {
		expect(clampFilesystem("read", "write")).toBe("read");
	});
	it("clamps base to ceiling when base > ceiling", () => {
		expect(clampFilesystem("write", "read")).toBe("read");
	});
	it("off clamp off = off", () => {
		expect(clampFilesystem("off", "off")).toBe("off");
	});
	it("write clamp off = off", () => {
		expect(clampFilesystem("write", "off")).toBe("off");
	});
});

describe("clampNetwork", () => {
	it("returns base when no ceiling", () => {
		expect(clampNetwork("full", undefined)).toBe("full");
	});
	it("full clamp search = search", () => {
		expect(clampNetwork("full", "search")).toBe("search");
	});
	it("search clamp fetch = search", () => {
		expect(clampNetwork("search", "fetch")).toBe("search");
	});
	it("fetch clamp search = search", () => {
		expect(clampNetwork("fetch", "search")).toBe("search");
	});
	it("off clamp full = off", () => {
		expect(clampNetwork("off", "full")).toBe("off");
	});
});

describe("clampShell", () => {
	it("exec clamp readonly = readonly", () => {
		expect(clampShell("exec", "readonly")).toBe("readonly");
	});
	it("readonly clamp off = off", () => {
		expect(clampShell("readonly", "off")).toBe("off");
	});
	it("off clamp exec = off", () => {
		expect(clampShell("off", "exec")).toBe("off");
	});
});

describe("clampSubagents", () => {
	it("on clamp off = off", () => {
		expect(clampSubagents("on", "off")).toBe("off");
	});
	it("off clamp on = off", () => {
		expect(clampSubagents("off", "on")).toBe("off");
	});
	it("on clamp undefined = on", () => {
		expect(clampSubagents("on", undefined)).toBe("on");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/level-order.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/adapter-core/src/policy/level-order.ts
import type {
	FilesystemLevel,
	NetworkLevel,
	ShellLevel,
	SubagentLevel,
} from "./types.js";

const FILESYSTEM_ORDER: readonly FilesystemLevel[] = ["off", "read", "write"];
const NETWORK_ORDER: readonly NetworkLevel[] = [
	"off",
	"search",
	"fetch",
	"full",
];
const SHELL_ORDER: readonly ShellLevel[] = ["off", "readonly", "exec"];
const SUBAGENT_ORDER: readonly SubagentLevel[] = ["off", "on"];

function getLevelIndex<T extends string>(
	label: string,
	order: readonly T[],
	value: T,
): number {
	const idx = order.indexOf(value);
	if (idx === -1) {
		throw new Error(
			`Invalid ${label} level "${value}". Valid: ${order.join(", ")}`,
		);
	}
	return idx;
}

function clampLevel<T extends string>(
	label: string,
	order: readonly T[],
	base: T,
	ceiling: T | undefined,
): T {
	if (ceiling === undefined) return base;
	return order[
		Math.min(getLevelIndex(label, order, base), getLevelIndex(label, order, ceiling))
	];
}

export function clampFilesystem(
	base: FilesystemLevel,
	ceiling: FilesystemLevel | undefined,
): FilesystemLevel {
	return clampLevel("filesystem", FILESYSTEM_ORDER, base, ceiling);
}

export function clampNetwork(
	base: NetworkLevel,
	ceiling: NetworkLevel | undefined,
): NetworkLevel {
	return clampLevel("network", NETWORK_ORDER, base, ceiling);
}

export function clampShell(
	base: ShellLevel,
	ceiling: ShellLevel | undefined,
): ShellLevel {
	return clampLevel("shell", SHELL_ORDER, base, ceiling);
}

export function clampSubagents(
	base: SubagentLevel,
	ceiling: SubagentLevel | undefined,
): SubagentLevel {
	return clampLevel("subagents", SUBAGENT_ORDER, base, ceiling);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/level-order.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-core/src/policy/level-order.ts packages/adapter-core/__tests__/policy/level-order.test.ts
git commit -m "feat(adapter-core): add capability level-order helpers with tests"
```

---

## Task 3: Role Contracts & Presets

**Files:**
- Create: `packages/adapter-core/src/policy/role-contracts.ts`
- Create: `packages/adapter-core/src/policy/presets.ts`
- Create: `packages/adapter-core/__tests__/policy/role-contracts.test.ts`
- Create: `packages/adapter-core/__tests__/policy/presets.test.ts`

- [ ] **Step 1: Write failing role-contracts test**

```typescript
// packages/adapter-core/__tests__/policy/role-contracts.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";

describe("DEFAULT_ROLE_CONTRACTS", () => {
	it("proposer has no capability ceilings", () => {
		expect(DEFAULT_ROLE_CONTRACTS.proposer.ceilings).toEqual({});
	});

	it("challenger has no capability ceilings", () => {
		expect(DEFAULT_ROLE_CONTRACTS.challenger.ceilings).toEqual({});
	});

	it("judge has strict ceilings", () => {
		const j = DEFAULT_ROLE_CONTRACTS.judge;
		expect(j.ceilings).toEqual({
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		});
	});

	it("proposer may introduce new proposals", () => {
		expect(
			DEFAULT_ROLE_CONTRACTS.proposer.semantics.mayIntroduceNewProposal,
		).toBe(true);
	});

	it("challenger may NOT introduce new proposals", () => {
		expect(
			DEFAULT_ROLE_CONTRACTS.challenger.semantics.mayIntroduceNewProposal,
		).toBe(false);
	});

	it("judge exploration is forbidden", () => {
		expect(DEFAULT_ROLE_CONTRACTS.judge.semantics.exploration).toBe(
			"forbidden",
		);
	});

	it("judge factCheck is minimal", () => {
		expect(DEFAULT_ROLE_CONTRACTS.judge.semantics.factCheck).toBe("minimal");
	});

	it("challenger evidenceBar is high", () => {
		expect(DEFAULT_ROLE_CONTRACTS.challenger.semantics.evidenceBar).toBe(
			"high",
		);
	});

	it("constants are frozen and cannot be mutated", () => {
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge.semantics)).toBe(true);
		expect(Object.isFrozen(DEFAULT_ROLE_CONTRACTS.judge.ceilings)).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/role-contracts.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write role-contracts implementation**

```typescript
// packages/adapter-core/src/policy/role-contracts.ts
import type { DebateRole } from "../types.js";
import type { RoleContract } from "./types.js";

function deepFreeze<T extends object>(obj: T): Readonly<T> {
	for (const value of Object.values(obj)) {
		if (value && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return Object.freeze(obj);
}

export const DEFAULT_ROLE_CONTRACTS: Readonly<Record<DebateRole, RoleContract>> =
	deepFreeze({
		proposer: {
			semantics: {
				exploration: "allowed",
				factCheck: "allowed",
				mayIntroduceNewProposal: true,
				evidenceBar: "medium",
			},
			ceilings: {},
		},
		challenger: {
			semantics: {
				exploration: "allowed",
				factCheck: "allowed",
				mayIntroduceNewProposal: false,
				evidenceBar: "high",
			},
			ceilings: {},
		},
		judge: {
			semantics: {
				exploration: "forbidden",
				factCheck: "minimal",
				mayIntroduceNewProposal: false,
				evidenceBar: "high",
			},
			ceilings: {
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			},
		},
	});
```

- [ ] **Step 4: Run role-contracts test**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/role-contracts.test.ts`
Expected: all PASS

- [ ] **Step 5: Write failing presets test**

```typescript
// packages/adapter-core/__tests__/policy/presets.test.ts
import { describe, expect, it } from "vitest";
import { PRESET_EXPANSIONS } from "../../src/policy/presets.js";

describe("PRESET_EXPANSIONS", () => {
	it("research: read-only, search, shell off, on-risk, maxTurns 12", () => {
		const r = PRESET_EXPANSIONS.research;
		expect(r.capabilities).toEqual({
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		});
		expect(r.interaction.approval).toBe("on-risk");
		expect(r.interaction.limits?.maxTurns).toBe(12);
	});

	it("guarded: write, search, readonly shell, on-risk, no limits", () => {
		const g = PRESET_EXPANSIONS.guarded;
		expect(g.capabilities).toEqual({
			filesystem: "write",
			network: "search",
			shell: "readonly",
			subagents: "off",
		});
		expect(g.interaction.approval).toBe("on-risk");
		expect(g.interaction.limits).toBeUndefined();
	});

	it("dangerous: full access, never ask", () => {
		const d = PRESET_EXPANSIONS.dangerous;
		expect(d.capabilities).toEqual({
			filesystem: "write",
			network: "full",
			shell: "exec",
			subagents: "on",
		});
		expect(d.interaction.approval).toBe("never");
	});

	it("plan: same capabilities as research, approval always", () => {
		const p = PRESET_EXPANSIONS.plan;
		expect(p.capabilities).toEqual(PRESET_EXPANSIONS.research.capabilities);
		expect(p.interaction.approval).toBe("always");
		expect(p.interaction.limits).toBeUndefined();
	});

	it("no preset contains provider-specific fields", () => {
		for (const [, expansion] of Object.entries(PRESET_EXPANSIONS)) {
			const keys = [
				...Object.keys(expansion.capabilities),
				...Object.keys(expansion.interaction),
			];
			expect(keys).not.toContain("permissionMode");
			expect(keys).not.toContain("approvalPolicy");
			expect(keys).not.toContain("sandboxPolicy");
			expect(keys).not.toContain("approvalMode");
		}
	});

	it("constants are frozen", () => {
		expect(Object.isFrozen(PRESET_EXPANSIONS)).toBe(true);
	});
});
```

- [ ] **Step 6: Write presets implementation**

```typescript
// packages/adapter-core/src/policy/presets.ts
import type { CapabilityPolicy, InteractionPolicy, PolicyPreset } from "./types.js";

export interface PresetExpansion {
	readonly capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">;
	readonly interaction: InteractionPolicy;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
	for (const value of Object.values(obj)) {
		if (value && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return Object.freeze(obj);
}

export const PRESET_EXPANSIONS: Readonly<Record<PolicyPreset, PresetExpansion>> =
	deepFreeze({
		research: {
			capabilities: {
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			},
			interaction: {
				approval: "on-risk",
				limits: { maxTurns: 12 },
			},
		},
		guarded: {
			capabilities: {
				filesystem: "write",
				network: "search",
				shell: "readonly",
				subagents: "off",
			},
			interaction: {
				approval: "on-risk",
			},
		},
		dangerous: {
			capabilities: {
				filesystem: "write",
				network: "full",
				shell: "exec",
				subagents: "on",
			},
			interaction: {
				approval: "never",
			},
		},
		plan: {
			capabilities: {
				filesystem: "read",
				network: "search",
				shell: "off",
				subagents: "off",
			},
			interaction: {
				approval: "always",
			},
		},
	});
```

- [ ] **Step 7: Run both tests**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/role-contracts.test.ts __tests__/policy/presets.test.ts`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-core/src/policy/role-contracts.ts packages/adapter-core/src/policy/presets.ts packages/adapter-core/__tests__/policy/role-contracts.test.ts packages/adapter-core/__tests__/policy/presets.test.ts
git commit -m "feat(adapter-core): add default role contracts and preset expansion table"
```

---

## Task 4: Policy Compiler

**Files:**
- Create: `packages/adapter-core/src/policy/compiler.ts`
- Create: `packages/adapter-core/src/policy/index.ts`
- Modify: `packages/adapter-core/src/index.ts`
- Create: `packages/adapter-core/__tests__/policy/compiler.test.ts`

- [ ] **Step 1: Write failing compiler tests**

```typescript
// packages/adapter-core/__tests__/policy/compiler.test.ts
import { describe, expect, it } from "vitest";
import { compilePolicy } from "../../src/policy/compiler.js";
import { DEFAULT_ROLE_CONTRACTS } from "../../src/policy/role-contracts.js";

describe("compilePolicy", () => {
	describe("preset x role combinations", () => {
		it("research + proposer: no clamping (empty ceilings)", () => {
			const p = compilePolicy({ preset: "research", role: "proposer" });
			expect(p.preset).toBe("research");
			expect(p.capabilities.filesystem).toBe("read");
			expect(p.capabilities.shell).toBe("off");
			expect(p.interaction.approval).toBe("on-risk");
			expect(p.interaction.limits?.maxTurns).toBe(12);
		});

		it("research + judge: capabilities clamped by judge ceilings", () => {
			const p = compilePolicy({ preset: "research", role: "judge" });
			expect(p.capabilities.network).toBe("search");
			expect(p.capabilities.shell).toBe("off");
			expect(p.capabilities.subagents).toBe("off");
		});

		it("dangerous + judge: capabilities clamped down hard", () => {
			const p = compilePolicy({ preset: "dangerous", role: "judge" });
			expect(p.capabilities.shell).toBe("off");
			expect(p.capabilities.network).toBe("search");
			expect(p.capabilities.subagents).toBe("off");
			expect(p.capabilities.filesystem).toBe("read");
		});

		it("dangerous + proposer: no clamping", () => {
			const p = compilePolicy({ preset: "dangerous", role: "proposer" });
			expect(p.capabilities.shell).toBe("exec");
			expect(p.capabilities.network).toBe("full");
			expect(p.capabilities.subagents).toBe("on");
			expect(p.capabilities.filesystem).toBe("write");
		});

		it("guarded + challenger: no clamping", () => {
			const p = compilePolicy({ preset: "guarded", role: "challenger" });
			expect(p.capabilities.filesystem).toBe("write");
			expect(p.capabilities.shell).toBe("readonly");
		});

		it("plan + judge: capabilities within judge ceilings", () => {
			const p = compilePolicy({ preset: "plan", role: "judge" });
			expect(p.capabilities.filesystem).toBe("read");
			expect(p.capabilities.shell).toBe("off");
			expect(p.interaction.approval).toBe("always");
		});
	});

	describe("legacy tool overrides", () => {
		it("attaches legacyToolOverrides when provided", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read", "Grep"], deny: ["WebFetch"] },
			});
			expect(p.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
			});
		});

		it("skips legacyToolOverrides when both are empty", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: [], deny: [] },
			});
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("skips legacyToolOverrides when undefined", () => {
			const p = compilePolicy({ preset: "guarded", role: "proposer" });
			expect(p.capabilities.legacyToolOverrides).toBeUndefined();
		});

		it("attaches when only allow is provided", () => {
			const p = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			expect(p.capabilities.legacyToolOverrides?.allow).toEqual(["Read"]);
			expect(p.capabilities.legacyToolOverrides?.deny).toBeUndefined();
		});
	});

	describe("roleContract in output", () => {
		it("includes correct roleContract for judge", () => {
			const p = compilePolicy({ preset: "plan", role: "judge" });
			expect(p.roleContract.semantics.exploration).toBe("forbidden");
			expect(p.roleContract.semantics.factCheck).toBe("minimal");
			expect(p.roleContract.ceilings.shell).toBe("off");
		});
	});

	describe("immutability", () => {
		it("does not mutate DEFAULT_ROLE_CONTRACTS", () => {
			const before = JSON.stringify(DEFAULT_ROLE_CONTRACTS);
			compilePolicy({ preset: "dangerous", role: "judge" });
			compilePolicy({ preset: "research", role: "proposer" });
			expect(JSON.stringify(DEFAULT_ROLE_CONTRACTS)).toBe(before);
		});

		it("returned policy objects are independent", () => {
			const p1 = compilePolicy({ preset: "research", role: "proposer" });
			const p2 = compilePolicy({ preset: "research", role: "proposer" });
			expect(p1).toEqual(p2);
			expect(p1).not.toBe(p2);
			expect(p1.roleContract).not.toBe(p2.roleContract);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/compiler.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write compiler implementation**

```typescript
// packages/adapter-core/src/policy/compiler.ts
import type {
	CapabilityCeilings,
	CapabilityPolicy,
	CompilePolicyInput,
	LegacyToolPolicyInput,
	ResolvedPolicy,
	RoleContract,
} from "./types.js";
import {
	clampFilesystem,
	clampNetwork,
	clampShell,
	clampSubagents,
} from "./level-order.js";
import { DEFAULT_ROLE_CONTRACTS } from "./role-contracts.js";
import { PRESET_EXPANSIONS } from "./presets.js";

function copyRoleContract(rc: RoleContract): RoleContract {
	return {
		semantics: { ...rc.semantics },
		ceilings: { ...rc.ceilings },
	};
}

function clampCapabilities(
	base: Omit<CapabilityPolicy, "legacyToolOverrides">,
	ceilings: CapabilityCeilings,
): Omit<CapabilityPolicy, "legacyToolOverrides"> {
	return {
		filesystem: clampFilesystem(base.filesystem, ceilings.filesystem),
		network: clampNetwork(base.network, ceilings.network),
		shell: clampShell(base.shell, ceilings.shell),
		subagents: clampSubagents(base.subagents, ceilings.subagents),
	};
}

function applyLegacyToolOverrides(
	capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">,
	legacyToolPolicy: LegacyToolPolicyInput | undefined,
): CapabilityPolicy {
	if (!legacyToolPolicy) return capabilities;

	const hasAllow =
		legacyToolPolicy.allow !== undefined && legacyToolPolicy.allow.length > 0;
	const hasDeny =
		legacyToolPolicy.deny !== undefined && legacyToolPolicy.deny.length > 0;

	if (!hasAllow && !hasDeny) return capabilities;

	return {
		...capabilities,
		legacyToolOverrides: {
			...(hasAllow ? { allow: legacyToolPolicy.allow } : {}),
			...(hasDeny ? { deny: legacyToolPolicy.deny } : {}),
			source: "legacy-profile" as const,
		},
	};
}

export function compilePolicy(input: CompilePolicyInput): ResolvedPolicy {
	const { preset, role, legacyToolPolicy } = input;

	const presetExpansion = PRESET_EXPANSIONS[preset];
	const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

	const clampedCapabilities = clampCapabilities(
		presetExpansion.capabilities,
		roleContract.ceilings,
	);

	const capabilities = applyLegacyToolOverrides(
		clampedCapabilities,
		legacyToolPolicy,
	);

	return {
		preset,
		roleContract,
		capabilities,
		interaction: presetExpansion.interaction,
	};
}
```

- [ ] **Step 4: Create barrel export and wire into adapter-core**

```typescript
// packages/adapter-core/src/policy/index.ts
export * from "./types.js";
export * from "./level-order.js";
export * from "./role-contracts.js";
export * from "./presets.js";
export * from "./compiler.js";
```

Add to `packages/adapter-core/src/index.ts`:

```typescript
export * from "./policy/index.js";
```

- [ ] **Step 5: Run all policy tests**

Run: `pnpm --filter @crossfire/adapter-core exec vitest run __tests__/policy/`
Expected: all PASS

- [ ] **Step 6: Run full adapter-core test suite**

Run: `pnpm --filter @crossfire/adapter-core test`
Expected: all PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-core/src/policy/compiler.ts packages/adapter-core/src/policy/index.ts packages/adapter-core/src/index.ts packages/adapter-core/__tests__/policy/compiler.test.ts
git commit -m "feat(adapter-core): add policy compiler with preset expansion and role clamping"
```

---

## Task 5: Claude Policy Translation

**Files:**
- Create: `packages/adapter-claude/src/policy-translation.ts`
- Create: `packages/adapter-claude/__tests__/policy-translation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/adapter-claude/__tests__/policy-translation.test.ts
import { describe, expect, it } from "vitest";
import { compilePolicy } from "@crossfire/adapter-core";
import { translatePolicy, CLAUDE_SUBAGENT_TOOLS } from "../src/policy-translation.js";

describe("translatePolicy (Claude)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(warnings.filter((w) => w.field === "interaction.approval")).toEqual(
				[],
			);
		});

		it("never -> bypassPermissions (exact)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("bypassPermissions");
			expect(native.allowDangerouslySkipPermissions).toBe(true);
		});

		it("always -> default (approximate) when capabilities not plan-shaped", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = { ...policy, interaction: { approval: "always" as const } };
			const { native, warnings } = translatePolicy(modified);
			expect(native.permissionMode).toBe("default");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("plan");
		});

		it("on-failure -> default (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.permissionMode).toBe("default");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("intentional behavior delta", () => {
		it("research preset no longer maps to dontAsk for Claude", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.permissionMode).toBe("default");
			expect(native.permissionMode).not.toBe("dontAsk");
		});
	});

	describe("capability -> tool deny", () => {
		it("shell off denies Bash", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
		});

		it("filesystem read denies Edit and Write", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Edit");
			expect(native.disallowedTools).toContain("Write");
			expect(native.disallowedTools).not.toContain("Read");
		});

		it("subagents off denies subagent tools", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			for (const tool of CLAUDE_SUBAGENT_TOOLS) {
				expect(native.disallowedTools).toContain(tool);
			}
		});
	});

	describe("legacy tool overrides", () => {
		it("cannot breach enum ceiling", () => {
			const policy = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: { allow: ["Bash"] },
			});
			const { native, warnings } = translatePolicy(policy);
			expect(native.disallowedTools).toContain("Bash");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.legacyToolOverrides.allow",
					reason: "approximate",
				}),
			);
		});
	});

	describe("limits", () => {
		it("maxTurns passes through", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.maxTurns).toBe(12);
		});

		it("unsupported limits produce warnings", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				interaction: {
					...policy.interaction,
					limits: { maxTurns: 12, maxToolCalls: 50, timeoutMs: 30000 },
				},
			};
			const { warnings } = translatePolicy(modified);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxToolCalls",
					reason: "not_implemented",
				}),
			);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.timeoutMs",
					reason: "not_implemented",
				}),
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-claude exec vitest run __tests__/policy-translation.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write Claude translation implementation**

```typescript
// packages/adapter-claude/src/policy-translation.ts
import type {
	CapabilityPolicy,
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import type { ClaudePermissionMode } from "./types.js";

export interface ClaudeNativeOptions {
	permissionMode: ClaudePermissionMode;
	maxTurns?: number;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowDangerouslySkipPermissions?: boolean;
}

// Tool name constants — single update point if SDK surface changes
const CLAUDE_SHELL_TOOLS = ["Bash"];
const CLAUDE_FILESYSTEM_ALL_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "LS"];
const CLAUDE_FILESYSTEM_WRITE_TOOLS = ["Edit", "Write"];
const CLAUDE_NETWORK_TOOLS = ["WebFetch"];
// Verify against installed claude-agent-sdk — "Task" is known from current codebase
export const CLAUDE_SUBAGENT_TOOLS = ["Task"];

function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

function translateApproval(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): { permissionMode: ClaudePermissionMode; allowDangerouslySkipPermissions?: boolean } {
	if (isPlanShape(policy)) {
		return { permissionMode: "plan" };
	}

	switch (policy.interaction.approval) {
		case "never":
			return {
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
			};
		case "on-risk":
			return { permissionMode: "default" };
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message:
					"Claude has no per-tool-must-approve mode; mapped to default",
			});
			return { permissionMode: "default" };
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no on-failure approval; mapped to default",
			});
			return { permissionMode: "default" };
	}
}

function computeBaseDenyList(capabilities: CapabilityPolicy): string[] {
	const deny: string[] = [];

	if (capabilities.shell === "off") deny.push(...CLAUDE_SHELL_TOOLS);
	if (capabilities.filesystem === "off") deny.push(...CLAUDE_FILESYSTEM_ALL_TOOLS);
	else if (capabilities.filesystem === "read") deny.push(...CLAUDE_FILESYSTEM_WRITE_TOOLS);
	if (capabilities.network === "off") deny.push(...CLAUDE_NETWORK_TOOLS);
	if (capabilities.subagents === "off") deny.push(...CLAUDE_SUBAGENT_TOOLS);

	return deny;
}

function buildToolPolicy(
	capabilities: CapabilityPolicy,
	warnings: PolicyTranslationWarning[],
): { allowedTools?: string[]; disallowedTools?: string[] } {
	const baseDeny = computeBaseDenyList(capabilities);

	if (!capabilities.legacyToolOverrides) {
		return baseDeny.length > 0 ? { disallowedTools: baseDeny } : {};
	}

	const { allow, deny } = capabilities.legacyToolOverrides;

	const conflicting = allow?.filter((tool) => baseDeny.includes(tool));
	if (conflicting?.length) {
		warnings.push({
			field: "capabilities.legacyToolOverrides.allow",
			adapter: "claude",
			reason: "approximate",
			message: `Tools [${conflicting.join(", ")}] blocked by capability enum, legacy allow ignored`,
		});
	}

	const effectiveAllow = allow?.filter((tool) => !baseDeny.includes(tool));
	const effectiveDeny = [
		...baseDeny,
		...(deny ?? []),
	];

	return {
		...(effectiveAllow?.length ? { allowedTools: effectiveAllow } : {}),
		...(effectiveDeny.length ? { disallowedTools: effectiveDeny } : {}),
	};
}

function warnUnsupportedLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
	if (limits.maxToolCalls !== undefined) {
		warnings.push({
			field: "interaction.limits.maxToolCalls",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support maxToolCalls limit",
		});
	}
	if (limits.timeoutMs !== undefined) {
		warnings.push({
			field: "interaction.limits.timeoutMs",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support timeoutMs limit",
		});
	}
	if (limits.budgetUsd !== undefined) {
		warnings.push({
			field: "interaction.limits.budgetUsd",
			adapter: "claude",
			reason: "not_implemented",
			message: "Claude does not support budgetUsd limit",
		});
	}
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<ClaudeNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];

	const { permissionMode, allowDangerouslySkipPermissions } = translateApproval(
		policy,
		warnings,
	);
	const toolPolicy = buildToolPolicy(policy.capabilities, warnings);
	const maxTurns = policy.interaction.limits?.maxTurns;
	warnUnsupportedLimits(policy.interaction.limits, warnings);

	return {
		native: {
			permissionMode,
			maxTurns,
			...toolPolicy,
			...(allowDangerouslySkipPermissions
				? { allowDangerouslySkipPermissions }
				: {}),
		},
		warnings,
	};
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crossfire/adapter-claude exec vitest run __tests__/policy-translation.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude/src/policy-translation.ts packages/adapter-claude/__tests__/policy-translation.test.ts
git commit -m "feat(adapter-claude): add policy translation with approval mapping and tool deny lists"
```

---

## Task 6: Codex Policy Translation

**Files:**
- Create: `packages/adapter-codex/src/policy-translation.ts`
- Create: `packages/adapter-codex/__tests__/policy-translation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/adapter-codex/__tests__/policy-translation.test.ts
import { describe, expect, it } from "vitest";
import { compilePolicy } from "@crossfire/adapter-core";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Codex)", () => {
	describe("approval mapping", () => {
		it("on-risk -> on-request (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
		});

		it("on-failure -> on-failure (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.approvalPolicy).toBe("on-failure");
			expect(
				warnings.filter((w) => w.field === "interaction.approval"),
			).toEqual([]);
		});

		it("never -> never (exact)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("never");
		});

		it("always -> on-request (approximate)", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalPolicy).toBe("on-request");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("sandbox mapping", () => {
		it("research (read, search, shell off) -> readOnly", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "readOnly" });
		});

		it("guarded (write, readonly shell) -> workspace-write", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "workspace-write" });
		});

		it("dangerous (exec, full) -> danger-full-access", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.sandboxPolicy).toEqual({ type: "danger-full-access" });
		});
	});

	describe("network disabled", () => {
		it("network off -> networkDisabled true", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				capabilities: { ...policy.capabilities, network: "off" as const },
			};
			const { native } = translatePolicy(modified);
			expect(native.networkDisabled).toBe(true);
		});

		it("network search -> networkDisabled false", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.networkDisabled).toBe(false);
		});
	});

	describe("limits", () => {
		it("maxTurns produces not_implemented warning", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxTurns",
					adapter: "codex",
					reason: "not_implemented",
				}),
			);
		});
	});

	describe("legacy tool overrides", () => {
		it("emits not_implemented warning when present", () => {
			const policy = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.legacyToolOverrides",
					adapter: "codex",
					reason: "not_implemented",
				}),
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-codex exec vitest run __tests__/policy-translation.test.ts`
Expected: FAIL

- [ ] **Step 3: Write Codex translation implementation**

```typescript
// packages/adapter-codex/src/policy-translation.ts
import type {
	CapabilityPolicy,
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export interface CodexNativeOptions {
	approvalPolicy: "on-request" | "on-failure" | "never";
	sandboxPolicy: { type: "readOnly" } | { type: "workspace-write" } | { type: "danger-full-access" };
	networkDisabled: boolean;
}

type SandboxLevel = "readOnly" | "workspace-write" | "danger-full-access";
const SANDBOX_ORDER: SandboxLevel[] = ["readOnly", "workspace-write", "danger-full-access"];

function maxSandbox(a: SandboxLevel, b: SandboxLevel): SandboxLevel {
	return SANDBOX_ORDER[Math.max(SANDBOX_ORDER.indexOf(a), SANDBOX_ORDER.indexOf(b))];
}

function translateApproval(
	approval: ResolvedPolicy["interaction"]["approval"],
	warnings: PolicyTranslationWarning[],
): CodexNativeOptions["approvalPolicy"] {
	switch (approval) {
		case "on-failure":
			return "on-failure";
		case "never":
			return "never";
		case "on-risk":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no on-risk approval; mapped to on-request",
			});
			return "on-request";
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "codex",
				reason: "approximate",
				message: "Codex has no always-approve mode; mapped to on-request",
			});
			return "on-request";
	}
}

function translateSandbox(
	capabilities: CapabilityPolicy,
	warnings: PolicyTranslationWarning[],
): CodexNativeOptions["sandboxPolicy"] {
	let level: SandboxLevel = "readOnly";

	if (capabilities.filesystem === "write") {
		level = maxSandbox(level, "workspace-write");
	}
	if (capabilities.shell === "exec") {
		level = maxSandbox(level, "danger-full-access");
	}
	if (capabilities.network === "full") {
		level = maxSandbox(level, "danger-full-access");
		warnings.push({
			field: "capabilities.network",
			adapter: "codex",
			reason: "approximate",
			message: "Codex full network requires danger-full-access sandbox",
		});
	}

	return { type: level };
}

function warnUnsupportedLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
	if (limits.maxTurns !== undefined) {
		warnings.push({
			field: "interaction.limits.maxTurns",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support per-session turn limits",
		});
	}
	if (limits.maxToolCalls !== undefined) {
		warnings.push({
			field: "interaction.limits.maxToolCalls",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support maxToolCalls limit",
		});
	}
	if (limits.timeoutMs !== undefined) {
		warnings.push({
			field: "interaction.limits.timeoutMs",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support timeoutMs limit",
		});
	}
	if (limits.budgetUsd !== undefined) {
		warnings.push({
			field: "interaction.limits.budgetUsd",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not support budgetUsd limit",
		});
	}
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<CodexNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];

	const approvalPolicy = translateApproval(policy.interaction.approval, warnings);
	const sandboxPolicy = translateSandbox(policy.capabilities, warnings);
	const networkDisabled = policy.capabilities.network === "off";

	if (policy.capabilities.legacyToolOverrides) {
		warnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "codex",
			reason: "not_implemented",
			message: "Codex does not consume per-tool allow/deny lists",
		});
	}

	warnUnsupportedLimits(policy.interaction.limits, warnings);

	return {
		native: { approvalPolicy, sandboxPolicy, networkDisabled },
		warnings,
	};
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crossfire/adapter-codex exec vitest run __tests__/policy-translation.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-codex/src/policy-translation.ts packages/adapter-codex/__tests__/policy-translation.test.ts
git commit -m "feat(adapter-codex): add policy translation with sandbox mapping and approval"
```

---

## Task 7: Gemini Policy Translation

**Files:**
- Create: `packages/adapter-gemini/src/policy-translation.ts`
- Create: `packages/adapter-gemini/__tests__/policy-translation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/adapter-gemini/__tests__/policy-translation.test.ts
import { describe, expect, it } from "vitest";
import { compilePolicy } from "@crossfire/adapter-core";
import { translatePolicy } from "../src/policy-translation.js";

describe("translatePolicy (Gemini)", () => {
	describe("approval mapping", () => {
		it("on-risk -> default (exact)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("default");
		});

		it("never -> yolo (approximate)", () => {
			const policy = compilePolicy({ preset: "dangerous", role: "proposer" });
			const { native, warnings } = translatePolicy(policy);
			expect(native.approvalMode).toBe("yolo");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});

		it("always -> plan when full policy shape matches", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { native } = translatePolicy(policy);
			expect(native.approvalMode).toBe("plan");
		});

		it("always -> default when shape does not match", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = { ...policy, interaction: { approval: "always" as const } };
			const { native } = translatePolicy(modified);
			expect(native.approvalMode).toBe("default");
		});

		it("on-failure -> auto_edit (approximate)", () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			const modified = {
				...policy,
				interaction: { approval: "on-failure" as const },
			};
			const { native, warnings } = translatePolicy(modified);
			expect(native.approvalMode).toBe("auto_edit");
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.approval",
					reason: "approximate",
				}),
			);
		});
	});

	describe("capability warnings", () => {
		it("filesystem off produces not_implemented warning", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const modified = {
				...policy,
				capabilities: { ...policy.capabilities, filesystem: "off" as const },
			};
			const { warnings } = translatePolicy(modified);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.filesystem",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});

		it("shell off does NOT produce warning (Gemini default is no shell)", () => {
			const policy = compilePolicy({ preset: "plan", role: "judge" });
			const { warnings } = translatePolicy(policy);
			const shellWarnings = warnings.filter(
				(w) => w.field === "capabilities.shell",
			);
			expect(shellWarnings).toEqual([]);
		});
	});

	describe("legacy tool overrides", () => {
		it("emits not_implemented warning when present", () => {
			const policy = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy: { allow: ["Read"] },
			});
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "capabilities.legacyToolOverrides",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});
	});

	describe("limits", () => {
		it("all limits produce not_implemented warnings", () => {
			const policy = compilePolicy({ preset: "research", role: "proposer" });
			const { warnings } = translatePolicy(policy);
			expect(warnings).toContainEqual(
				expect.objectContaining({
					field: "interaction.limits.maxTurns",
					adapter: "gemini",
					reason: "not_implemented",
				}),
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossfire/adapter-gemini exec vitest run __tests__/policy-translation.test.ts`
Expected: FAIL

- [ ] **Step 3: Write Gemini translation implementation**

```typescript
// packages/adapter-gemini/src/policy-translation.ts
import type {
	PolicyTranslationWarning,
	ProviderTranslationResult,
	ResolvedPolicy,
} from "@crossfire/adapter-core";

export interface GeminiNativeOptions {
	approvalMode: "default" | "auto_edit" | "plan" | "yolo";
}

function isPlanShape(policy: ResolvedPolicy): boolean {
	const { capabilities: c, interaction: i } = policy;
	return (
		i.approval === "always" &&
		(c.filesystem === "off" || c.filesystem === "read") &&
		c.shell === "off" &&
		c.subagents === "off" &&
		(c.network === "off" || c.network === "search")
	);
}

function translateApproval(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): GeminiNativeOptions["approvalMode"] {
	if (isPlanShape(policy)) return "plan";

	switch (policy.interaction.approval) {
		case "on-risk":
			return "default";
		case "on-failure":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no on-failure mode; mapped to auto_edit",
			});
			return "auto_edit";
		case "never":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini yolo is CLI-only; may not be settable at runtime",
			});
			return "yolo";
		case "always":
			warnings.push({
				field: "interaction.approval",
				adapter: "gemini",
				reason: "approximate",
				message: "Gemini has no always-approve mode; mapped to default",
			});
			return "default";
	}
}

function warnCapabilities(
	policy: ResolvedPolicy,
	warnings: PolicyTranslationWarning[],
): void {
	if (policy.capabilities.filesystem === "off") {
		warnings.push({
			field: "capabilities.filesystem",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling filesystem access",
		});
	}
	if (policy.capabilities.network === "off") {
		warnings.push({
			field: "capabilities.network",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini CLI does not support disabling network access",
		});
	}
	if (policy.capabilities.legacyToolOverrides) {
		warnings.push({
			field: "capabilities.legacyToolOverrides",
			adapter: "gemini",
			reason: "not_implemented",
			message: "Gemini does not consume per-tool allow/deny lists",
		});
	}
}

function warnAllLimits(
	limits: ResolvedPolicy["interaction"]["limits"],
	warnings: PolicyTranslationWarning[],
): void {
	if (!limits) return;
	for (const [key, value] of Object.entries(limits)) {
		if (value !== undefined) {
			warnings.push({
				field: `interaction.limits.${key}`,
				adapter: "gemini",
				reason: "not_implemented",
				message: `Gemini does not support ${key} limit`,
			});
		}
	}
}

export function translatePolicy(
	policy: ResolvedPolicy,
): ProviderTranslationResult<GeminiNativeOptions> {
	const warnings: PolicyTranslationWarning[] = [];

	const approvalMode = translateApproval(policy, warnings);
	warnCapabilities(policy, warnings);
	warnAllLimits(policy.interaction.limits, warnings);

	return {
		native: { approvalMode },
		warnings,
	};
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crossfire/adapter-gemini exec vitest run __tests__/policy-translation.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-gemini/src/policy-translation.ts packages/adapter-gemini/__tests__/policy-translation.test.ts
git commit -m "feat(adapter-gemini): add policy translation with approval mode mapping"
```

---

## Task 8: Interface Changes — Add policy to StartSessionInput, TurnInput, and AdapterMap

**Files:**
- Modify: `packages/adapter-core/src/types.ts`
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: `docs/architecture/adapter-layer.md`

- [ ] **Step 1: Add policy field and deprecation markers**

In `packages/adapter-core/src/types.ts`, add to `StartSessionInput`:

```typescript
export interface StartSessionInput {
	profile: string;
	workingDirectory: string;
	model?: string;
	mcpServers?: Record<string, unknown>;
	/** @deprecated Use policy.capabilities.legacyToolOverrides instead */
	allowedTools?: string[];
	/** @deprecated Use policy.capabilities.legacyToolOverrides instead */
	disallowedTools?: string[];
	permissionMode?: "auto" | "approve-all" | "deny-all";
	/** @deprecated Use policy.preset instead */
	executionMode?: RoleExecutionMode;
	providerOptions?: Record<string, unknown>;
	/** New policy path — when present, adapters should use translatePolicy() */
	policy?: ResolvedPolicy;
}
```

Add import at top of file:

```typescript
import type { ResolvedPolicy } from "./policy/types.js";
```

Add to `TurnInput`:

```typescript
export interface TurnInput {
	prompt: string;
	turnId: string;
	timeout?: number;
	/** @deprecated Use policy instead */
	executionMode?: TurnExecutionMode;
	role?: DebateRole;
	roundNumber?: number;
	/** Per-turn policy override — when present, adapter re-translates for this turn */
	policy?: ResolvedPolicy;
}
```

Add deprecation JSDoc to old mode types:

```typescript
/** @deprecated Use PolicyPreset from policy/types instead */
export type RoleExecutionMode = "research" | "guarded" | "dangerous";

/** @deprecated Use PolicyPreset from policy/types instead */
export type TurnExecutionMode = RoleExecutionMode | "plan";
```

- [ ] **Step 2: Widen AdapterMap in runner.ts**

In `packages/orchestrator/src/runner.ts`, update the `AdapterMap` type to accept optional policy fields (all optional, so backward-compatible):

```typescript
import type { ResolvedPolicy, LegacyToolPolicyInput } from "@crossfire/adapter-core";

export interface AdapterMap {
	proposer: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
	};
	challenger: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
	};
	judge?: {
		adapter: AgentAdapter;
		session: SessionHandle;
		baselinePolicy?: ResolvedPolicy;
		legacyToolPolicyInput?: LegacyToolPolicyInput;
	};
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: all packages compile successfully

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: all PASS (no regressions — field additions are backward compatible)

- [ ] **Step 5: Update docs/architecture/adapter-layer.md**

Add a subsection documenting the new `policy?: ResolvedPolicy` field on `StartSessionInput`, `TurnInput`, and `AdapterMap` entries. Explain that when `policy` is present, adapters should use `translatePolicy()` instead of the deprecated `executionMode` field.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-core/src/types.ts packages/orchestrator/src/runner.ts docs/architecture/adapter-layer.md
git commit -m "feat: add policy field to StartSessionInput, TurnInput, and AdapterMap, deprecate old mode types"
```

---

## Task 9: Adapter Integration — Wire translatePolicy into startSession/sendTurn

**Files:**
- Modify: `packages/adapter-claude/src/claude-adapter.ts`
- Modify: `packages/adapter-codex/src/codex-adapter.ts`
- Modify: `packages/adapter-gemini/src/gemini-adapter.ts`

This is the most complex task. Each adapter gains a policy path in `startSession` and `sendTurn`, with the old path preserved as fallback.

- [ ] **Step 1: Claude adapter — store baseline policy in session config**

In `packages/adapter-claude/src/claude-adapter.ts`, update `ClaudeSessionConfig`:

```typescript
import type { ResolvedPolicy } from "@crossfire/adapter-core";
import { translatePolicy } from "./policy-translation.js";

interface ClaudeSessionConfig {
	model?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	baselinePolicy?: ResolvedPolicy;
}
```

Update `startSession`:

```typescript
async startSession(input: StartSessionInput): Promise<SessionHandle> {
	sessionCounter++;
	const adapterSessionId = `claude-session-${sessionCounter}-${Date.now()}`;
	this.sessionConfigs.set(adapterSessionId, {
		model: input.model,
		allowedTools: input.allowedTools,
		disallowedTools: input.disallowedTools,
		baselinePolicy: input.policy,
	});
	return {
		adapterSessionId,
		providerSessionId: undefined,
		adapterId: "claude",
		transcript: [],
	};
}
```

- [ ] **Step 2: Claude adapter — use policy in sendTurn**

In the `sendTurn` method, before the `this.queryFn(...)` call, add policy path:

```typescript
async sendTurn(handle: SessionHandle, input: TurnInput): Promise<TurnHandle> {
	// ... existing ctx, localMetrics setup ...

	const sessionConfig = this.sessionConfigs.get(handle.adapterSessionId);
	const activePolicy = input.policy ?? sessionConfig?.baselinePolicy;

	let queryOptions: Record<string, unknown>;
	if (activePolicy) {
		// New policy path
		const { native, warnings } = translatePolicy(activePolicy);
		for (const w of warnings) {
			this.emit({
				kind: "run.warning",
				adapterId: "claude",
				adapterSessionId: handle.adapterSessionId,
				turnId: input.turnId,
				message: `[policy] ${w.field}: ${w.message}`,
				timestamp: Date.now(),
			});
		}
		queryOptions = {
			permissionMode: native.permissionMode,
			maxTurns: native.maxTurns,
			allowedTools: native.allowedTools,
			disallowedTools: native.disallowedTools,
			allowDangerouslySkipPermissions: native.allowDangerouslySkipPermissions,
		};
	} else {
		// Legacy fallback
		queryOptions = mapExecutionModeToClaudeQueryOptions(input.executionMode, {
			allowedTools: sessionConfig?.allowedTools,
			disallowedTools: sessionConfig?.disallowedTools,
		});
	}

	// ... rest of sendTurn using queryOptions ...
}
```

- [ ] **Step 3: Codex adapter — same pattern**

In `packages/adapter-codex/src/codex-adapter.ts`:

Store `baselinePolicy` in session state. In `sendTurn`, check `input.policy ?? baselinePolicy`. If policy exists, call `translatePolicy()` from `./policy-translation.js` and use native options for the `turn/start` request. Emit `run.warning` events for any warnings. Keep legacy fallback via `mapExecutionModeToCodexPolicies()`.

- [ ] **Step 4: Gemini adapter — same pattern**

In `packages/adapter-gemini/src/gemini-adapter.ts`:

Store `baselinePolicy` in context. In `sendTurn`, check `input.policy ?? context.baselinePolicy`. If policy exists, call `translatePolicy()` and use `native.approvalMode` for CLI args. Emit `run.warning` events. Keep legacy fallback via `mapExecutionModeToGeminiApprovalMode()`.

- [ ] **Step 5: Run all adapter tests**

Run: `pnpm test`
Expected: all PASS

- [ ] **Step 6a: Commit Claude**

```bash
git add packages/adapter-claude/src/claude-adapter.ts
git commit -m "feat(adapter-claude): wire translatePolicy into startSession/sendTurn with legacy fallback"
```

- [ ] **Step 6b: Commit Codex**

```bash
git add packages/adapter-codex/src/codex-adapter.ts
git commit -m "feat(adapter-codex): wire translatePolicy into startSession/sendTurn with legacy fallback"
```

- [ ] **Step 6c: Commit Gemini**

```bash
git add packages/adapter-gemini/src/gemini-adapter.ts
git commit -m "feat(adapter-gemini): wire translatePolicy into startSession/sendTurn with legacy fallback"
```

---

## Task 10: CLI Wiring — compilePolicy in create-adapters.ts

**Files:**
- Modify: `packages/cli/src/wiring/create-adapters.ts`
- Modify: `packages/cli/__tests__/wiring.test.ts`
- Modify: `docs/architecture/adapter-layer.md`

- [ ] **Step 1: Update create-adapters.ts**

In `packages/cli/src/wiring/create-adapters.ts`:

Add imports:

```typescript
import {
	compilePolicy,
	type LegacyToolPolicyInput,
	type PolicyPreset,
	type ResolvedPolicy,
} from "@crossfire/adapter-core";
```

Update `startRole` to compile policy:

```typescript
async function startRole(
	roleName: "proposer" | "challenger" | "judge",
	role: ResolvedRole,
) {
	const preset: PolicyPreset =
		roleName === "judge"
			? "plan"
			: ((executionModes?.roleModes?.[roleName] ??
				executionModes?.defaultMode ??
				"guarded") as PolicyPreset);

	const legacyToolPolicyInput: LegacyToolPolicyInput | undefined =
		role.profile.allowed_tools || role.profile.disallowed_tools
			? {
					allow: role.profile.allowed_tools,
					deny: role.profile.disallowed_tools,
				}
			: undefined;

	const policy = compilePolicy({
		preset,
		role: roleName,
		legacyToolPolicy: legacyToolPolicyInput,
	});

	const adapter = factories[role.adapterType]();
	const session = await adapter.startSession({
		profile: role.profile.name,
		workingDirectory: process.cwd(),
		model: role.model,
		mcpServers: role.profile.mcp_servers,
		policy,
		// Keep legacy fields for fallback during migration
		allowedTools: role.profile.allowed_tools,
		disallowedTools: role.profile.disallowed_tools,
		executionMode:
			roleName === "judge"
				? undefined
				: (executionModes?.roleModes?.[roleName] ??
					executionModes?.defaultMode),
		providerOptions: { systemPrompt: role.systemPrompt },
	});
	started.push({ adapter, session });
	return { adapter, session, baselinePolicy: policy, legacyToolPolicyInput };
}
```

Update `AdapterBundle` / return types to include baseline policy and legacy tool policy input in each adapter entry.

- [ ] **Step 2: Update wiring tests**

In `packages/cli/__tests__/wiring.test.ts`, add:

```typescript
it("passes compiled policy to adapter startSession", async () => {
	const roles: ResolvedRoles = {
		proposer: {
			profile: makeProfile("claude_code"),
			model: undefined,
			adapterType: "claude",
		},
		challenger: {
			profile: makeProfile("codex"),
			model: undefined,
			adapterType: "codex",
		},
		judge: {
			profile: makeProfile("gemini_cli"),
			model: undefined,
			adapterType: "gemini",
		},
	};
	const mock = mockAdapter("claude");
	await createAdapters(roles, {
		claude: () => mock,
		codex: () => mockAdapter("codex"),
		gemini: () => mockAdapter("gemini"),
	});
	const startCall = (mock.startSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
	expect(startCall.policy).toBeDefined();
	expect(startCall.policy.preset).toBe("guarded");
	expect(startCall.policy.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
});

it("judge gets plan preset by default", async () => {
	const roles: ResolvedRoles = {
		proposer: {
			profile: makeProfile("claude_code"),
			model: undefined,
			adapterType: "claude",
		},
		challenger: {
			profile: makeProfile("codex"),
			model: undefined,
			adapterType: "codex",
		},
		judge: {
			profile: makeProfile("gemini_cli"),
			model: undefined,
			adapterType: "gemini",
		},
	};
	const judgeMock = mockAdapter("gemini");
	await createAdapters(roles, {
		claude: () => mockAdapter("claude"),
		codex: () => mockAdapter("codex"),
		gemini: () => judgeMock,
	});
	const startCall = (judgeMock.startSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
	expect(startCall.policy.preset).toBe("plan");
	expect(startCall.policy.roleContract.semantics.exploration).toBe("forbidden");
});

it("profile allowed_tools flow into legacy tool overrides", async () => {
	const profileWithTools = {
		...makeProfile("claude_code"),
		allowed_tools: ["Read", "Grep"],
		disallowed_tools: ["WebFetch"],
	};
	const roles: ResolvedRoles = {
		proposer: {
			profile: profileWithTools,
			model: undefined,
			adapterType: "claude",
		},
		challenger: {
			profile: makeProfile("codex"),
			model: undefined,
			adapterType: "codex",
		},
	};
	const mock = mockAdapter("claude");
	await createAdapters(roles, {
		claude: () => mock,
		codex: () => mockAdapter("codex"),
		gemini: () => mockAdapter("gemini"),
	});
	const startCall = (mock.startSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
	expect(startCall.policy.capabilities.legacyToolOverrides).toEqual({
		allow: ["Read", "Grep"],
		deny: ["WebFetch"],
		source: "legacy-profile",
	});
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @crossfire/cli test`
Expected: all PASS

- [ ] **Step 4: Update docs/architecture/adapter-layer.md**

Add a section documenting the policy compilation flow: CLI `--mode` flag → `PolicyPreset` → `compilePolicy()` → `ResolvedPolicy` → adapter `translatePolicy()` → provider-native options.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/wiring/create-adapters.ts packages/cli/__tests__/wiring.test.ts docs/architecture/adapter-layer.md
git commit -m "feat(cli): compile policies in create-adapters wiring, pass to adapters"
```

---

## Task 11: Orchestrator Integration — Runner and Judge

**Files:**
- Modify: `packages/orchestrator/src/runner.ts`
- Modify: `packages/orchestrator/src/judge.ts`
- Modify: `packages/orchestrator-core/src/execution-modes.ts`
- Modify: `packages/orchestrator/__tests__/judge.test.ts`
- Modify: `docs/architecture/execution-modes.md`

- [ ] **Step 1: Add compilePolicy import to runner.ts**

In `packages/orchestrator/src/runner.ts`, add the import (the `AdapterMap` type was already widened in Task 8):

```typescript
import { compilePolicy, type PolicyPreset } from "@crossfire/adapter-core";
```

- [ ] **Step 2: Update sendTurn call site in runner.ts**

At the `resolveExecutionMode` call site (around line 484), add policy compilation:

```typescript
const executionModeResult = resolveExecutionMode(
	config.executionModes,
	role,
	turnId,
);

// Compile per-turn policy if baseline exists
const turnPolicy = adapterEntry.baselinePolicy
	? compilePolicy({
			preset: executionModeResult.effectiveMode as PolicyPreset,
			role: role as "proposer" | "challenger" | "judge",
			legacyToolPolicy: adapterEntry.legacyToolPolicyInput,
		})
	: undefined;

// ... existing turn.mode.changed event push ...

await adapterEntry.adapter.sendTurn(adapterEntry.session, {
	turnId,
	prompt,
	policy: turnPolicy,
	executionMode: executionModeResult.effectiveMode,
});
```

- [ ] **Step 3: Update judge turn call**

In the judge call site (around line 364), pass baseline policy:

```typescript
const result = await runJudgeTurn(
	adapters.judge.adapter,
	adapters.judge.session,
	bus,
	{
		...judgeTurnInput,
		policy: adapters.judge.baselinePolicy,
	},
);
```

- [ ] **Step 4: Update judge.ts — remove executionMode hardcode**

In `packages/orchestrator/src/judge.ts`, update `runJudgeTurn` to accept and forward policy:

```typescript
export interface JudgeTurnInput {
	turnId: string;
	prompt: string;
	roundNumber: number;
	policy?: ResolvedPolicy;
}

export async function runJudgeTurn(
	adapter: AgentAdapter,
	handle: SessionHandle,
	bus: DebateEventBus,
	input: JudgeTurnInput,
): Promise<JudgeTurnResult> {
	// ...
	await adapter.sendTurn(handle, {
		turnId: input.turnId,
		prompt: input.prompt,
		policy: input.policy,
		// Remove: executionMode: "plan" — now handled via policy
		role: "judge",
		roundNumber: input.roundNumber,
	});
	// ...
}
```

- [ ] **Step 5: Update execution-modes.ts as compat wrapper**

Add a new function to `packages/orchestrator-core/src/execution-modes.ts`:

```typescript
import { compilePolicy, type CompilePolicyInput, type ResolvedPolicy } from "@crossfire/adapter-core";

/** @deprecated Use compilePolicy() directly */
export function resolveExecutionModeAsPolicy(
	config: DebateExecutionConfig | undefined,
	role: DebateExecutionRole,
	turnId: string,
): { resolved: ResolvedExecutionMode; policy: ResolvedPolicy } {
	const resolved = resolveExecutionMode(config, role, turnId);
	const policy = compilePolicy({
		preset: resolved.effectiveMode as CompilePolicyInput["preset"],
		role,
	});
	return { resolved, policy };
}
```

Keep existing `resolveExecutionMode` unchanged for backward compat.

- [ ] **Step 6: Update judge tests**

In `packages/orchestrator/__tests__/judge.test.ts`, verify judge no longer sends `executionMode: "plan"` and instead uses policy.

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: all PASS

- [ ] **Step 8: Update docs/architecture/execution-modes.md**

Remove the old `research → dontAsk` mapping documentation. Add section on the policy model: presets are provider-agnostic, `compilePolicy()` produces `ResolvedPolicy`, adapters translate to native options.

- [ ] **Step 9: Commit**

```bash
git add packages/orchestrator/src/runner.ts packages/orchestrator/src/judge.ts packages/orchestrator-core/src/execution-modes.ts packages/orchestrator/__tests__/judge.test.ts docs/architecture/execution-modes.md
git commit -m "feat(orchestrator): integrate policy compilation in runner and judge, update execution-modes docs"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: all packages compile

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all PASS

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors

- [ ] **Step 4: Verify no console.log in production code**

Run: `grep -r "console.log" packages/*/src/ --include="*.ts" | grep -v node_modules | grep -v ".test." | grep -v "__tests__"`
Expected: no new console.log statements
