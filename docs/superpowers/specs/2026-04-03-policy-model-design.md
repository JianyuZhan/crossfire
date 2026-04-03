# Crossfire Policy Model RFC

**Date:** 2026-04-03
**Status:** Draft
**Scope:** A-scope (model layer only, shell unchanged)

## Problem Statement

Crossfire conflates "product-layer semantics" (what the user intends) with "provider landing parameters" (how each adapter configures its backend). The current `RoleExecutionMode` type (`research | guarded | dangerous`) maps directly to provider-native permission modes, but the three providers have fundamentally incompatible control surfaces:

- **Claude Code**: `dontAsk` is a silent allowlist execution mode, not a research mode
- **Codex**: separates sandbox policy from approval policy natively
- **Gemini CLI**: `plan` is a read-only planning mode, `yolo` is CLI-only

Mapping all three to a single `research` is pseudo-unification. The result: user mental model is unclear, adapter boundaries leak, and observability is impossible.

## Design Thesis

> **Mode should be demoted to a preset (UX shorthand). The first-class objects are policies: role contract, capability policy, and interaction policy.**

This RFC introduces a formal compilation layer from "user intent" to "provider parameters", making Crossfire policy-first instead of provider-first.

## Scope Boundaries

### In scope (A-scope)

1. Core policy types in `adapter-core`
2. Policy compiler (pure function)
3. 4 built-in presets and 3 default role contracts
4. Adapter `translatePolicy()` for Claude, Codex, Gemini
5. Integration into `create-adapters.ts` with legacy fallback
6. Judge special-case absorption into role contract defaults
7. Tests: compiler, translation, backward compatibility

### Explicitly out of scope

- Profile file format changes (B-scope)
- `crossfire inspect-profile` / runtime `/status policy` (B/C-scope)
- Evidence policy as user-configurable surface (B/C-scope)
- Full abstract tool capability taxonomy (C-scope)
- New CLI flags (B-scope)
- Prompt template changes driven by role semantics (B-scope)

### Design-for-B constraint

All types, naming, and compiler interfaces are designed so B-scope (profile split, new CLI flags, inspect-profile) can be added without changing core types.

---

## 1. Core Type System

Location: `packages/adapter-core/src/policy/types.ts`

### 1.1 CapabilityPolicy

```typescript
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
```

**Key rules:**
- Enums are the first-class model; `legacyToolOverrides` is a compatibility layer
- All fields `readonly` to prevent adapter mutation
- Enum is the ceiling: `shell: "off"` cannot be breached by `legacyToolOverrides.allow: ["Bash"]`
- `legacyToolOverrides.source` is always `"legacy-profile"`, marking provenance
- Enums are NOT comparable strings; explicit level-order helpers required (see Section 3)

### 1.2 RoleContract

```typescript
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
```

**Key rules:**
- `semantics` routes to prompt builder / orchestrator behavior
- `ceilings` routes to capability clamp
- These two paths MUST NOT cross: semantics never implicitly modifies capabilities
- `ceilings` is `Partial` — unspecified dimensions impose no ceiling
- `ceilings` excludes `legacyToolOverrides` — role ceilings don't involve legacy compatibility

**Invariant:** `RoleContract = semantic duties + capability ceilings, never default capabilities.`

### 1.3 InteractionPolicy

```typescript
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
```

**Key rules:**
- 4-level approval retained (Codex natively supports `on-failure`)
- `limits` is a separate sub-object from `approval`
- A-scope compiler only implements `approval` + `limits.maxTurns`
- Other limit fields enter `ResolvedPolicy` but may produce translation warnings

**A-scope constraint:** In A-scope, interaction policy is preset-derived only and is not role-clamped. This is NOT a permanent principle — B/C-scope may introduce interaction ceilings per role.

### 1.4 ResolvedPolicy

```typescript
export type PolicyPreset = "research" | "guarded" | "dangerous" | "plan";

export type ResolvedPolicy = {
  readonly preset: PolicyPreset;
  readonly roleContract: RoleContract;
  readonly capabilities: CapabilityPolicy;
  readonly interaction: InteractionPolicy;
};
```

**Key rules:**
- `preset` is a readonly provenance tag for observability, logging, and diagnostics
- `preset` MUST NOT be used as a discriminator: `if (policy.preset === "research")` is forbidden in compiler and adapter code
- All behavior determined by `roleContract` / `capabilities` / `interaction`
- Warning messages may reference `policy.preset` for human-readable text, but warning trigger conditions must be based on specific field values

### 1.5 Translation Result

```typescript
export type PolicyTranslationWarning = {
  readonly field: string;  // structured path, e.g. "interaction.limits.maxToolCalls"
  readonly adapter: AdapterId;
  readonly reason: "unsupported" | "approximate" | "not_implemented";
  readonly message: string;
};

export type ProviderTranslationResult<TNative> = {
  readonly native: TNative;
  readonly warnings: readonly PolicyTranslationWarning[];
};
```

**Key rules:**
- `field` uses structured paths (e.g. `capabilities.legacyToolOverrides.allow`)
- `adapter` uses `AdapterId` type, not bare string
- `TNative` is adapter-specific: `ClaudeNativeOptions`, `CodexNativeOptions`, `GeminiNativeOptions`
- Warnings belong to translation, not to policy — `ResolvedPolicy` never carries "provider X doesn't support this" information

---

## 2. Built-in Presets & Default Role Contracts

### 2.1 Default Role Contracts

Location: `packages/adapter-core/src/policy/role-contracts.ts`

| Role | semantics.exploration | semantics.factCheck | semantics.mayIntroduceNewProposal | semantics.evidenceBar | ceilings |
|---|---|---|---|---|---|
| **proposer** | allowed | allowed | true | medium | `{}` (no ceiling) |
| **challenger** | allowed | allowed | false | high | `{}` (no ceiling) |
| **judge** | forbidden | minimal | false | high | `{ filesystem: "read", network: "search", shell: "off", subagents: "off" }` |

**Design rationale:**
- Proposer/challenger are "working roles" — their differentiation is primarily semantic, not capability-based
- Judge has strict ceilings to prevent it from becoming a third debater
- Judge's `network: "search"` ceiling leaves room for minimal fact-checking
- Empty ceilings `{}` for proposer/challenger ensure all presets (including `dangerous`) work without clamp

**Immutability:** Default role contracts must be deep-frozen at module load. `compilePolicy()` must return copies, not references to the frozen constants.

### 2.2 Preset Expansion Table

Location: `packages/adapter-core/src/policy/presets.ts`

| Preset | filesystem | network | shell | subagents | approval | limits |
|---|---|---|---|---|---|---|
| **research** | read | search | off | off | on-risk | maxTurns: 12 |
| **guarded** | write | search | readonly | off | on-risk | — |
| **dangerous** | write | full | exec | on | never | — |
| **plan** | read | search | off | off | always | — |

**Key decisions:**
- `research` = high evidence density + mostly read-only. NOT "low approval". `approval: "on-risk"`, not `"never"`
- `maxTurns: 12` is a policy value in the `research` preset, not a Claude-specific special case
- `plan` and `research` have identical capabilities but different approval posture
- Presets do NOT carry RoleContract — preset is "work mode", role contract is "role identity", orthogonal dimensions

**Invariant:** Presets are provider-agnostic intent shorthands. Provider-specific differences may only appear in adapter translation, never in preset expansion.

**Note:** "Judge defaults to plan preset" is a decision made by the orchestrator/CLI wiring layer, NOT by the policy type system.

---

## 3. Policy Compiler

Location: `packages/adapter-core/src/policy/compiler.ts`

### 3.1 Input

```typescript
export type LegacyToolPolicyInput = {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
};

export type CompilePolicyInput = {
  readonly preset: PolicyPreset;
  readonly role: DebateRole;
  readonly legacyToolPolicy?: LegacyToolPolicyInput;
};
```

### 3.2 Compilation Pipeline

```
preset expansion → role ceiling clamp → legacy tool overrides refine
```

Fixed order. Each step is a pure function.

```typescript
export function compilePolicy(input: CompilePolicyInput): ResolvedPolicy {
  const { preset, role, legacyToolPolicy } = input;

  // Step 1: Expand preset baseline
  const presetExpansion = PRESET_EXPANSIONS[preset];

  // Step 2: Get role contract (deep copy of frozen default)
  const roleContract = copyRoleContract(DEFAULT_ROLE_CONTRACTS[role]);

  // Step 3: Clamp capabilities by role ceilings
  const clampedCapabilities = clampCapabilities(
    presetExpansion.capabilities,
    roleContract.ceilings,
  );

  // Step 4: Apply legacy tool overrides (refine only, no escalation)
  const capabilities = applyLegacyToolOverrides(
    clampedCapabilities,
    legacyToolPolicy,
  );

  return { preset, roleContract, capabilities, interaction: presetExpansion.interaction };
}
```

### 3.3 Level-Order Helpers

Location: `packages/adapter-core/src/policy/level-order.ts`

```typescript
const FILESYSTEM_ORDER: readonly FilesystemLevel[] = ["off", "read", "write"];
const NETWORK_ORDER: readonly NetworkLevel[] = ["off", "search", "fetch", "full"];
const SHELL_ORDER: readonly ShellLevel[] = ["off", "readonly", "exec"];
const SUBAGENT_ORDER: readonly SubagentLevel[] = ["off", "on"];
```

`clampLevel(label, order, base, ceiling)` returns `order[min(indexOf(base), indexOf(ceiling))]`.

**Rules:**
- Uses labeled assertion (with dimension name) for invalid values, not generic `throw new Error`
- These are NOT string comparisons — always go through the level-order helpers

### 3.4 Legacy Tool Overrides

- Compiler attaches `legacyToolOverrides` when provided and non-empty
- Compiler does NOT validate tool names (they are provider-native strings)
- Compiler does NOT enforce "enum ceiling not breached by override" — that enforcement happens in adapter translation (only adapters know which tool names map to which capability dimensions)

---

## 4. Adapter Translation

Each adapter implements its own `translatePolicy()` pure function. This is the **only legitimate place for provider-specific differences**.

Location: `packages/adapter-{claude,codex,gemini}/src/policy-translation.ts`

### 4.1 Universal Contract

```typescript
function translatePolicy(
  policy: ResolvedPolicy,
): ProviderTranslationResult<TNativeOptions>
```

**Rules:**
- Pure function: input ResolvedPolicy, output native params + warnings
- Does NOT mutate policy
- Does NOT write back hints
- Does NOT perform role semantic inference
- If adapter does not consume `legacyToolOverrides`, it MUST emit `not_implemented` warning
- If `network: "search"` and `network: "fetch"` collapse to the same native parameter, MUST emit `approximate` warning

### 4.2 Approval Mapping

**Critical rule:** Do NOT use provider `plan` mode as the generic translation of `approval: "always"`. Provider `plan` is a holistic strategy shape (read-only + no execution + planning output), not merely "high approval frequency". Translation may select provider `plan` only when the **full policy shape** matches (capabilities mostly read-only + shell off + approval always), and this decision must be based on field values, never on `policy.preset`.

#### Claude

| Crossfire approval | Claude permissionMode | Precision |
|---|---|---|
| `always` | `default` | approximate (Claude has no per-tool-must-approve mode) |
| `on-risk` | `default` | exact |
| `on-failure` | `default` | approximate (no native equivalent) |
| `never` | `bypassPermissions` | exact |

Provider `plan` permissionMode: only when full policy shape matches ALL of: `capabilities.filesystem <= "read"`, `capabilities.shell === "off"`, `capabilities.subagents === "off"`, `capabilities.network <= "search"`, and `interaction.approval === "always"`. This check uses field values, never `policy.preset`.

#### Codex

| Crossfire approval | Codex approvalPolicy | Precision |
|---|---|---|
| `always` | `on-request` | approximate |
| `on-risk` | `on-request` | approximate |
| `on-failure` | `on-failure` | exact |
| `never` | `never` | exact |

#### Gemini

| Crossfire approval | Gemini approvalMode | Precision |
|---|---|---|
| `always` | `default` | approximate |
| `on-risk` | `default` | exact |
| `on-failure` | `auto_edit` | approximate |
| `never` | `yolo` | approximate (CLI-only flag) |

Provider `plan` approvalMode: same condition as Claude — all of `capabilities.filesystem <= "read"`, `capabilities.shell === "off"`, `capabilities.subagents === "off"`, `capabilities.network <= "search"`, and `interaction.approval === "always"`.

### 4.3 Capability Translation

#### Claude: capabilities to tool deny/allow lists

| Capability | Effect |
|---|---|
| `shell: "off"` | deny `Bash` |
| `filesystem: "off"` | deny `Read`, `Edit`, `Write`, `Glob`, `Grep`, `LS` |
| `filesystem: "read"` | deny `Edit`, `Write` |
| `network: "off"` | deny `WebFetch` + relevant MCP tools |
| `subagents: "off"` | deny subagent tool (see note below) |
| `subagents: "on"` | allow subagent tool |
| `legacyToolOverrides` | Merge into allow/deny lists; conflicting items (breaching enum ceiling) are dropped with `approximate` warning |

**Completeness note:** The deny list for each capability level must cover ALL Claude tools that belong to that capability dimension. The table above lists the known tools as of this writing; the implementation should define these as named constants (e.g., `CLAUDE_FILESYSTEM_TOOLS`, `CLAUDE_SHELL_TOOLS`, `CLAUDE_SUBAGENT_TOOLS`) so they can be maintained as Claude's tool surface evolves. `LS` is included in filesystem because it exposes directory structure even without reading file contents.

**Subagent tool name:** The current codebase uses `Task` in Claude's tool allowlist (`CLAUDE_RESEARCH_ALLOWED_TOOLS` in `claude-adapter.ts:66`) and hooks reference `SubagentStart`/`SubagentStop` as SDK event names. The actual tool name that Claude's SDK exposes for deny/allow is SDK-version-dependent and must be verified at implementation time against the installed `claude-agent-sdk` version. The implementation MUST:
1. Define a `CLAUDE_SUBAGENT_TOOLS` constant listing ALL tool names that correspond to the `subagents` capability dimension
2. Verify the constant against the SDK's actual tool surface (not assume a name from this spec)
3. Include the verified tool name(s) in both `subagents: "off"` deny lists and `subagents: "on"` allow lists
4. If the SDK tool name changes between versions, the constant is the single update point

#### Codex: capabilities to sandbox policy (per-dimension max requirement approach)

Compute minimum sandbox level for each dimension, then take the highest:

| Dimension | Resulting sandbox requirement |
|---|---|
| `filesystem: "off" \| "read"` | `readOnly` |
| `filesystem: "write"` | `workspace-write` |
| `shell: "off" \| "readonly"` | no escalation |
| `shell: "exec"` | `danger-full-access` |
| `network: "full"` | `danger-full-access` (or `approximate` warning) |

Final sandbox = max of all dimension requirements.

#### Gemini: limited capability control

Most capability fields produce `not_implemented` warnings. Gemini CLI does not support fine-grained filesystem/shell/network control.

### 4.4 Limits Translation

| Field | Claude | Codex | Gemini |
|---|---|---|---|
| `maxTurns` | Supported | `not_implemented` warning | `not_implemented` warning |
| `maxToolCalls` | `not_implemented` | `not_implemented` | `not_implemented` |
| `timeoutMs` | `not_implemented` | `not_implemented` | `not_implemented` |
| `budgetUsd` | `not_implemented` | `not_implemented` | `not_implemented` |

**Rule:** InteractionPolicy is fully modeled in A-scope, but only a supported subset is guaranteed to translate provider-natively. Unsupported fields MUST surface translation warnings rather than being silently ignored.

---

## 5. Integration Layer

### 5.1 Interface Changes

`StartSessionInput` gains `policy?: ResolvedPolicy`. `TurnInput` gains `policy?: ResolvedPolicy` (turn-level override).

Old fields (`executionMode`, `allowedTools`, `disallowedTools`) remain but are marked `@deprecated`. A-scope maintains both paths: new policy path and legacy fallback.

### 5.2 Baseline Policy Storage Contract

When `create-adapters.ts` compiles a baseline policy for each role, it must store two things on each adapter entry (the object the runner already holds per-role):

```typescript
// Added to the per-role adapter entry that runner.ts already maintains
interface AdapterEntry {
  adapter: AgentAdapter;
  session: SessionHandle;
  // --- new in A-scope ---
  baselinePolicy: ResolvedPolicy;
  legacyToolPolicyInput: LegacyToolPolicyInput | undefined;
}
```

**Why two fields:** `baselinePolicy` is the compiled result (used as fallback for turns without override). `legacyToolPolicyInput` is the original `{ allow, deny }` from the profile — needed for per-turn recompilation, because `ResolvedPolicy.capabilities.legacyToolOverrides` is the *output* of compilation (with `source: "legacy-profile"` tag), not a reusable *input* to `compilePolicy()`. Storing the original input avoids reverse-engineering.

### 5.3 Core Wiring Change: `create-adapters.ts`

```typescript
async function startRole(roleName: DebateRole, role: ResolvedRole) {
  // Judge baseline is hardcoded to "plan" in A-scope.
  // Current DebateExecutionConfig.roleModes only models proposer/challenger
  // (type: Partial<Record<DebateExecutionRole, ...>>), so judge is not
  // configurable via CLI --mode flags. This is intentional for A-scope;
  // B-scope may widen the config to include judge.
  const preset: PolicyPreset =
    roleName === "judge"
      ? "plan"
      : (executionModes?.roleModes?.[roleName] ?? executionModes?.defaultMode ?? "guarded");

  const legacyToolPolicyInput: LegacyToolPolicyInput | undefined =
    (role.profile.allowed_tools || role.profile.disallowed_tools)
      ? { allow: role.profile.allowed_tools, deny: role.profile.disallowed_tools }
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
    providerOptions: { systemPrompt: role.systemPrompt },
  });

  return { adapter, session, baselinePolicy: policy, legacyToolPolicyInput };
}
```

**A-scope constraint:** Judge baseline preset is hardcoded to `"plan"`. The existing `DebateExecutionConfig.roleModes` type (`Partial<Record<DebateExecutionRole, ...>>`) only covers `proposer | challenger`, and A-scope does NOT widen this. B-scope may add judge to the config surface.

### 5.4 Runner Change: `orchestrator/src/runner.ts`

The runner is where per-turn execution modes are currently resolved (line ~484: `resolveExecutionMode()` → `sendTurn({ executionMode })`). This file **must** be updated in A-scope to compile per-turn policies. The change is minimal but necessary:

```typescript
// runner.ts — per-turn policy compilation (replaces resolveExecutionMode call site)

// A-scope: resolveExecutionMode() still runs to produce the turn-level mode string
// (for backward compat, event emission, etc.), but additionally compiles a policy:
const executionModeResult = resolveExecutionMode(config.executionModes, role, turnId);
const turnPreset = executionModeResult.effectiveMode as PolicyPreset;

// Per-turn compilation carries forward the session baseline's legacyToolPolicyInput.
// Rationale: the user's profile-level allowed_tools/disallowed_tools apply to ALL
// turns for that role, not just the first. If a turn override changes the preset
// (e.g. from "guarded" to "research"), the tool overrides from the profile are
// still in effect — only the preset changes, not the tool policy.
const turnPolicy = compilePolicy({
  preset: turnPreset,
  role,
  legacyToolPolicy: adapterEntry.legacyToolPolicyInput,
});

await adapterEntry.adapter.sendTurn(adapterEntry.session, {
  turnId,
  prompt,
  policy: turnPolicy,           // new path
  executionMode: executionModeResult.effectiveMode,  // deprecated, kept for compat
});
```

**Key point:** The runner is NOT unchanged. It is the call site where per-turn overrides (from `DebateExecutionConfig.turnOverrides`) get compiled into `ResolvedPolicy` objects. Without this change, turn overrides cannot flow through the new policy path.

**Per-turn legacyToolPolicy rule:** When compiling a per-turn policy, the canonical source for `legacyToolPolicy` is `adapterEntry.legacyToolPolicyInput` — the original `{ allow, deny }` from the profile, stored at session start (Section 5.2). This is NOT extracted from the baseline `ResolvedPolicy.capabilities.legacyToolOverrides` (which is a compilation output, not a reusable input). A turn override changes the preset, but does NOT replace the profile-level tool overrides.

### 5.5 Adapter Behavior

- `startSession`: saves baseline policy; if `input.policy` exists, uses `translatePolicy()`; otherwise falls back to legacy path
- `sendTurn`: uses `input.policy ?? session.baselinePolicy`; if per-turn policy provided, re-translates for that turn
- Per-turn override via `sendTurn({ policy })` is the unified path for all roles including judge

### 5.6 Judge Special-Case Absorption

- Remove `executionMode: "plan"` hardcode from `orchestrator/judge.ts`
- Judge's baseline policy is determined at session start: `compilePolicy({ preset: "plan", role: "judge" })`
- `sendTurn` for judge no longer carries `executionMode`

**A-scope judge turn policy rules:**

1. **Scheduled judge turns** (end-of-round, final verdict): reuse the session baseline policy. The runner does NOT recompile — it passes `policy: judgeAdapterEntry.baselinePolicy` to `runJudgeTurn`.
2. **Turn overrides targeting judge**: NOT supported in A-scope. `DebateExecutionConfig.turnOverrides` uses `turnId` strings like `p-1`, `c-1`, which address proposer/challenger turns. Judge turns have IDs like `judge-1` but the existing `DebateExecutionRole` type only covers `proposer | challenger`, so turn overrides cannot legally target judge. This is consistent with the A-scope constraint that judge baseline is hardcoded to `plan`.
3. **`/inject judge`** (runtime injection): uses the same session baseline policy as scheduled judge turns.
4. **B-scope**: may introduce judge-targeted turn overrides by widening `DebateExecutionRole` and `DebateExecutionConfig`.

### 5.7 Warnings Output

A-scope: structured `PolicyTranslationWarning[]` stored internally in adapter session/turn state. Each warning also projected as a `run.warning` text event for logging and debugging. No new event type added.

### 5.8 Files NOT Changed

| File | Reason |
|---|---|
| `cli/src/commands/start.ts` | CLI flags unchanged, bridged in wiring |
| `cli/src/profile/schema.ts` | Profile format unchanged (B-scope) |
| `tui/*` | TUI does not need policy details |
| `prompts/*` | Prompt templates unchanged (semantics-driven prompts are B-scope) |

**Note:** `orchestrator/src/runner.ts` IS changed (Section 5.4). `orchestrator/src/run-debate.ts` may need minor signature changes to pass adapter entries with baseline policies, but its overall flow is unchanged.

### 5.9 Deprecated Type Migration

```typescript
// adapter-core/src/types.ts
/** @deprecated Use PolicyPreset from policy/types instead */
export type RoleExecutionMode = "research" | "guarded" | "dangerous";
/** @deprecated Use PolicyPreset from policy/types instead */
export type TurnExecutionMode = RoleExecutionMode | "plan";
```

Both old and new types coexist in A-scope. Old types used only in legacy fallback path. B-scope removes old types and fallback.

---

## 6. Testing Strategy

### 6.1 Three-Layer Testing

**Layer 1: Policy Core (adapter-core, pure unit tests)**

| Test file | Coverage |
|---|---|
| `policy/level-order.test.ts` | clampLevel correctness per dimension, boundary values, labeled assertions |
| `policy/compiler.test.ts` | 4 presets x 3 roles = 12 combinations; ceiling clamp; legacy overrides; immutability |
| `policy/presets.test.ts` | Exact snapshot of each preset expansion; no provider-specific content |
| `policy/role-contracts.test.ts` | Exact snapshot of defaults; judge strict ceilings; proposer/challenger empty ceilings |

**Layer 2: Adapter Translation (per-adapter, pure unit tests)**

| Test file | Coverage |
|---|---|
| `adapter-claude/policy-translation.test.ts` | 4 approval mappings; capability-to-tool-deny; legacy override no-escalation; plan mode shape matching; limits warnings |
| `adapter-codex/policy-translation.test.ts` | 4 approval mappings; per-dimension sandbox escalation; maxTurns warning; network disabled; legacyToolOverrides warning |
| `adapter-gemini/policy-translation.test.ts` | 4 approval mappings; capability not_implemented warnings; limits warnings; legacyToolOverrides warning |

**Layer 3: Integration Compatibility (cli package)**

| Test file | Coverage |
|---|---|
| `cli/wiring.test.ts` | Old `--mode` flags flow through compiler; adapter receives correct native options |
| `cli/profile-loader.test.ts` | Old profile `allowed_tools`/`disallowed_tools` flow into `legacyToolPolicy` |

### 6.2 Intentional Behavior Delta Testing

For the `research`/Claude semantic reset (`dontAsk` → `default`), tests must NOT claim equivalence. Instead:

1. **Compat invariants**: old profile fields still flow into compiler, old interface still hits fallback
2. **New path correctness**: assert new `ResolvedPolicy` and new Claude translation
3. **Explicit delta**: test named `documents intentional behavior delta: research preset no longer maps to dontAsk for Claude` — asserts `permissionMode === "default"` and `permissionMode !== "dontAsk"`

The deprecated legacy path continues to preserve old behavior during migration. The new policy path enforces new semantics. Both are testable independently.

### 6.3 Migration Order

Each step independently passes `pnpm build && pnpm test`:

```
Step 1:  adapter-core/src/policy/
         New types + level-order + presets + role-contracts + compiler
         All Layer 1 tests
         ─── commit ───

Step 2:  adapter-claude/src/policy-translation.ts
         New translatePolicy + Layer 2 tests (Claude)
         ─── commit ───

Step 3:  adapter-codex/src/policy-translation.ts
         Same pattern
         ─── commit ───

Step 4:  adapter-gemini/src/policy-translation.ts
         Same pattern
         ─── commit ───

Step 5:  adapter-core/src/types.ts
         StartSessionInput + TurnInput gain policy? field
         Old fields marked @deprecated
         ─── commit ───

Step 6a: adapter-claude/src/claude-adapter.ts
         startSession / sendTurn policy path + fallback
         ─── commit ───

Step 6b: adapter-codex/src/codex-adapter.ts
         Same pattern
         ─── commit ───

Step 6c: adapter-gemini/src/gemini-adapter.ts
         Same pattern
         ─── commit ───

Step 7:  cli/wiring/create-adapters.ts
         Compile baseline policies, store on adapter entries (Section 5.2-5.3)
         Return { adapter, session, baselinePolicy, legacyToolPolicyInput }
         Update docs/architecture/adapter-layer.md (wiring changes)
         Layer 3 compat tests
         ─── commit ───

Step 8:  orchestrator-core/execution-modes.ts → compat wrapper
         orchestrator/judge.ts → remove hardcode
         orchestrator/runner.ts → read adapterEntry.baselinePolicy/legacyToolPolicyInput,
           compile per-turn policies at sendTurn call sites (Section 5.4)
         Update docs/architecture/execution-modes.md (policy model, remove old
           research→dontAsk mapping)
         ─── commit ───
```

**Constraints:**
- Steps 1-4: pure additions, zero regression risk
- Step 5: interface change with backward compatibility
- Steps 6a-6c: independent per-adapter, easy to bisect
- Step 7 before Step 8: wiring must store baseline policies before runner can read them
- Steps 7-8: behavior switch point, highest regression surface
- **Architecture doc rule (per AGENTS.md):** each commit that changes types, interfaces, or data flow MUST update the relevant `docs/architecture/` page(s) in the same commit. Steps 5, 6a-6c, 7, and 8 each include their corresponding doc updates

---

## Design Invariants Summary

1. **Presets are provider-agnostic.** Same preset produces identical `ResolvedPolicy` regardless of target provider.
2. **RoleContract = semantic duties + capability ceilings, never default capabilities.**
3. **Semantics path and capabilities path do not cross.** Semantics never implicitly modifies capabilities.
4. **Enum is the ceiling.** `legacyToolOverrides` cannot breach capability enums; enforcement at adapter translation layer.
5. **`preset` is provenance tag, not discriminator.** No `if (policy.preset === ...)` in compiler or adapter.
6. **Translation is a pure function.** Input ResolvedPolicy, output native params + warnings. No mutation, no write-back.
7. **Provider plan mode is not approval: always.** Plan mode selection requires full policy shape match.
8. **Unsupported fields produce warnings, never silent drops.**
9. **A-scope: interaction policy is preset-derived only, not role-clamped.** (Not a permanent principle.)
10. **Compilation order is fixed:** preset expansion → role ceiling clamp → legacy overrides refine → adapter translation.
