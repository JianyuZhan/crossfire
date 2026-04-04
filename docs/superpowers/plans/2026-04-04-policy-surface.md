# Phase C — Policy Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the policy-first architecture into the primary user-facing surface — inspection commands, preset-first CLI, new config schema, adapter observation, and event-derived runtime state.

**Architecture:** Config foundation first (new schema + shared resolution module), then compiler diagnostics, then adapter observation (shared rule helpers + inspectPolicy()), then inspection commands, then CLI surface switch, then runtime state recording. Each layer depends on the one before it.

**Tech Stack:** TypeScript, Vitest, Commander.js, Zod, YAML (config files)

**Spec:** `docs/superpowers/specs/2026-04-04-policy-surface-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/cli/src/config/schema.ts` | New `CrossfireConfig`, `RoleProfileConfig`, `ProviderBindingConfig`, `McpServerConfig` Zod schemas |
| `packages/cli/src/config/loader.ts` | Load single YAML/JSON config file, validate binding + mcpServers references |
| `packages/cli/src/config/resolver.ts` | Resolve config + CLI flags into `ResolvedRoleRuntimeConfig` per role |
| `packages/cli/src/config/policy-resolution.ts` | `DEFAULT_ROLE_PRESETS`, `resolveRolePreset()` |
| `packages/cli/src/config/index.ts` | Public exports for config module |
| `packages/cli/src/commands/preset-options.ts` | New `--preset` / `--*-preset` / `--turn-preset` CLI flag parsing |
| `packages/cli/src/commands/inspect-policy.ts` | `crossfire inspect-policy` command |
| `packages/cli/src/commands/inspect-tools.ts` | `crossfire inspect-tools` command |
| `packages/cli/src/commands/inspection-context.ts` | Shared `buildInspectionContext()` pipeline |
| `packages/adapter-core/src/policy/observation-types.ts` | `ProviderObservationResult`, `PolicyTranslationSummary`, `CapabilityEffectRecord`, `ToolInspectionRecord`, `PolicyClampNote`, `CompilePolicyDiagnostics` types |
| `packages/adapter-claude/src/policy-observation.ts` | Claude `inspectPolicy()` + shared rule helpers |
| `packages/adapter-codex/src/policy-observation.ts` | Codex `inspectPolicy()` + shared rule helpers |
| `packages/adapter-gemini/src/policy-observation.ts` | Gemini `inspectPolicy()` + shared rule helpers |
| `packages/cli/__tests__/config/schema.test.ts` | Config schema validation tests |
| `packages/cli/__tests__/config/policy-resolution.test.ts` | Preset precedence tests |
| `packages/cli/__tests__/config/resolver.test.ts` | Resolver tests |
| `packages/adapter-core/__tests__/policy/compiler-diagnostics.test.ts` | Clamp note tests |
| `packages/adapter-claude/__tests__/policy-observation.test.ts` | Claude observation + consistency tests |
| `packages/adapter-codex/__tests__/policy-observation.test.ts` | Codex observation + consistency tests |
| `packages/adapter-gemini/__tests__/policy-observation.test.ts` | Gemini observation + consistency tests |
| `packages/cli/__tests__/commands/inspect-policy.test.ts` | Inspection command tests |
| `packages/cli/__tests__/commands/preset-options.test.ts` | Preset flag parsing tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/adapter-core/src/policy/compiler.ts` | Add `compilePolicyWithDiagnostics()`, refactor to `compilePolicyInternal()` |
| `packages/adapter-core/src/policy/types.ts` | Add `CapabilityLevelValue` type alias |
| `packages/adapter-core/src/policy/index.ts` | Export new types and diagnostics function |
| `packages/adapter-core/src/index.ts` | Export observation types |
| `packages/adapter-core/src/testing/policy-fixtures.ts` | Add `makeDiagnosticsInput()` fixture |
| `packages/adapter-claude/src/policy-translation.ts` | Extract shared rule helpers to policy-observation.ts, re-import |
| `packages/adapter-codex/src/policy-translation.ts` | Same extraction pattern |
| `packages/adapter-gemini/src/policy-translation.ts` | Same extraction pattern |
| `packages/cli/src/index.ts` | Register `inspect-policy` and `inspect-tools` commands |
| `packages/cli/src/commands/start.ts` | Switch from profile/mode-first to config/preset-first |
| `packages/cli/src/wiring/create-adapters.ts` | Use new config resolution instead of profile/mode resolution |
| `packages/orchestrator-core/src/orchestrator-events.ts` | Add policy event types, rename `turn.mode.changed` |
| `packages/orchestrator/src/runner.ts` | Emit policy events, use preset-first turn overrides |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/cli/src/commands/execution-mode-options.ts` | Replaced by `preset-options.ts` |
| `packages/cli/src/profile/schema.ts` | Replaced by `config/schema.ts` |
| `packages/cli/src/profile/loader.ts` | Replaced by `config/loader.ts` |
| `packages/cli/src/profile/resolver.ts` | Replaced by `config/resolver.ts` |

---

## Task 1: Config Schema and Validation

**Files:**
- Create: `packages/cli/src/config/schema.ts`
- Test: `packages/cli/__tests__/config/schema.test.ts`

- [ ] **Step 1: Write failing tests for config schema validation**

```ts
// packages/cli/__tests__/config/schema.test.ts
import { describe, expect, it } from "vitest";
import {
  CrossfireConfigSchema,
  type CrossfireConfig,
} from "../../src/config/schema.js";

describe("CrossfireConfigSchema", () => {
  const validConfig: CrossfireConfig = {
    providerBindings: [
      { name: "claude-default", adapter: "claude", model: "claude-sonnet" },
    ],
    roles: {
      proposer: { binding: "claude-default", preset: "guarded" },
      challenger: { binding: "claude-default", preset: "research" },
      judge: { binding: "claude-default", preset: "plan" },
    },
  };

  it("accepts a valid minimal config", () => {
    const result = CrossfireConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts config with mcpServers registry", () => {
    const config = {
      ...validConfig,
      mcpServers: {
        github: { command: "npx", args: ["-y", "mcp-github"] },
      },
      providerBindings: [
        {
          name: "claude-default",
          adapter: "claude",
          mcpServers: ["github"],
        },
      ],
    };
    const result = CrossfireConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects unknown adapter type", () => {
    const config = {
      ...validConfig,
      providerBindings: [{ name: "bad", adapter: "unknown" }],
    };
    const result = CrossfireConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("rejects unknown preset value", () => {
    const config = {
      ...validConfig,
      roles: {
        ...validConfig.roles,
        proposer: { binding: "claude-default", preset: "invalid" },
      },
    };
    const result = CrossfireConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("allows judge to be omitted", () => {
    const config = {
      providerBindings: validConfig.providerBindings,
      roles: {
        proposer: validConfig.roles.proposer,
        challenger: validConfig.roles.challenger,
      },
    };
    const result = CrossfireConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("allows preset to be omitted (default rule applies)", () => {
    const config = {
      ...validConfig,
      roles: {
        ...validConfig.roles,
        proposer: { binding: "claude-default" },
      },
    };
    const result = CrossfireConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && npx vitest run __tests__/config/schema.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config schema**

```ts
// packages/cli/src/config/schema.ts
import { z } from "zod";

const PolicyPresetSchema = z.enum(["research", "guarded", "dangerous", "plan"]);

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

const RoleProfileConfigSchema = z.object({
  binding: z.string(),
  model: z.string().optional(),
  preset: PolicyPresetSchema.optional(),
  systemPrompt: z.string().optional(),
});

export const CrossfireConfigSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema).optional(),
  providerBindings: z.array(ProviderBindingConfigSchema),
  roles: z.object({
    proposer: RoleProfileConfigSchema,
    challenger: RoleProfileConfigSchema,
    judge: RoleProfileConfigSchema.optional(),
  }),
});

export type CrossfireConfig = z.infer<typeof CrossfireConfigSchema>;
export type ProviderBindingConfig = z.infer<typeof ProviderBindingConfigSchema>;
export type RoleProfileConfig = z.infer<typeof RoleProfileConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && npx vitest run __tests__/config/schema.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/schema.ts packages/cli/__tests__/config/schema.test.ts
git commit -m "feat(config): add CrossfireConfig schema with Zod validation"
```

---

## Task 2: Shared Policy Resolution Module

**Files:**
- Create: `packages/cli/src/config/policy-resolution.ts`
- Test: `packages/cli/__tests__/config/policy-resolution.test.ts`

- [ ] **Step 1: Write failing tests for preset resolution**

```ts
// packages/cli/__tests__/config/policy-resolution.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PRESETS,
  resolveRolePreset,
} from "../../src/config/policy-resolution.js";

describe("DEFAULT_ROLE_PRESETS", () => {
  it("proposer defaults to guarded", () => {
    expect(DEFAULT_ROLE_PRESETS.proposer).toBe("guarded");
  });
  it("challenger defaults to guarded", () => {
    expect(DEFAULT_ROLE_PRESETS.challenger).toBe("guarded");
  });
  it("judge defaults to plan", () => {
    expect(DEFAULT_ROLE_PRESETS.judge).toBe("plan");
  });
});

describe("resolveRolePreset", () => {
  it("CLI role-specific preset wins over everything", () => {
    const result = resolveRolePreset({
      role: "proposer",
      configPreset: "research",
      cliGlobalPreset: "dangerous",
      cliRolePreset: "plan",
    });
    expect(result).toEqual({ preset: "plan", source: "cli-role" });
  });

  it("CLI global preset wins over config and default", () => {
    const result = resolveRolePreset({
      role: "proposer",
      configPreset: "research",
      cliGlobalPreset: "dangerous",
    });
    expect(result).toEqual({ preset: "dangerous", source: "cli-global" });
  });

  it("config preset wins over default", () => {
    const result = resolveRolePreset({
      role: "proposer",
      configPreset: "research",
    });
    expect(result).toEqual({ preset: "research", source: "config" });
  });

  it("falls back to role default when nothing specified", () => {
    const result = resolveRolePreset({ role: "proposer" });
    expect(result).toEqual({ preset: "guarded", source: "role-default" });
  });

  it("judge defaults to plan", () => {
    const result = resolveRolePreset({ role: "judge" });
    expect(result).toEqual({ preset: "plan", source: "role-default" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && npx vitest run __tests__/config/policy-resolution.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement policy resolution**

```ts
// packages/cli/src/config/policy-resolution.ts
import type { PolicyPreset } from "@crossfire/adapter-core";

export const DEFAULT_ROLE_PRESETS: Record<
  "proposer" | "challenger" | "judge",
  PolicyPreset
> = {
  proposer: "guarded",
  challenger: "guarded",
  judge: "plan",
} as const;

export type PresetSource = "cli-role" | "cli-global" | "config" | "role-default";

export interface ResolvedPreset {
  preset: PolicyPreset;
  source: PresetSource;
}

export function resolveRolePreset(input: {
  role: "proposer" | "challenger" | "judge";
  configPreset?: PolicyPreset;
  cliRolePreset?: PolicyPreset;
  cliGlobalPreset?: PolicyPreset;
}): ResolvedPreset {
  if (input.cliRolePreset) {
    return { preset: input.cliRolePreset, source: "cli-role" };
  }
  if (input.cliGlobalPreset) {
    return { preset: input.cliGlobalPreset, source: "cli-global" };
  }
  if (input.configPreset) {
    return { preset: input.configPreset, source: "config" };
  }
  return { preset: DEFAULT_ROLE_PRESETS[input.role], source: "role-default" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && npx vitest run __tests__/config/policy-resolution.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/policy-resolution.ts packages/cli/__tests__/config/policy-resolution.test.ts
git commit -m "feat(config): add shared policy resolution with preset precedence"
```

---

## Task 3: Config Loader and Resolver

**Files:**
- Create: `packages/cli/src/config/loader.ts`
- Create: `packages/cli/src/config/resolver.ts`
- Create: `packages/cli/src/config/index.ts`
- Test: `packages/cli/__tests__/config/resolver.test.ts`

- [ ] **Step 1: Write failing tests for config resolver**

```ts
// packages/cli/__tests__/config/resolver.test.ts
import { describe, expect, it } from "vitest";
import type { CrossfireConfig } from "../../src/config/schema.js";
import { resolveAllRoles } from "../../src/config/resolver.js";

const baseConfig: CrossfireConfig = {
  providerBindings: [
    { name: "claude-main", adapter: "claude", model: "claude-sonnet" },
    { name: "codex-main", adapter: "codex", model: "gpt-5-codex" },
  ],
  roles: {
    proposer: { binding: "claude-main", preset: "guarded" },
    challenger: { binding: "codex-main", preset: "research" },
    judge: { binding: "claude-main", preset: "plan" },
  },
};

describe("resolveAllRoles", () => {
  it("resolves all roles from config with no CLI overrides", () => {
    const roles = resolveAllRoles(baseConfig, {});
    expect(roles.proposer.adapter).toBe("claude");
    expect(roles.proposer.model).toBe("claude-sonnet");
    expect(roles.proposer.preset).toEqual({
      value: "guarded",
      source: "config",
    });
    expect(roles.challenger.adapter).toBe("codex");
    expect(roles.challenger.preset).toEqual({
      value: "research",
      source: "config",
    });
    expect(roles.judge?.preset).toEqual({ value: "plan", source: "config" });
  });

  it("role-level model overrides binding model", () => {
    const config: CrossfireConfig = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        proposer: {
          binding: "claude-main",
          preset: "guarded",
          model: "claude-opus",
        },
      },
    };
    const roles = resolveAllRoles(config, {});
    expect(roles.proposer.model).toBe("claude-opus");
  });

  it("CLI preset overrides config preset", () => {
    const roles = resolveAllRoles(baseConfig, {
      cliGlobalPreset: "dangerous",
    });
    expect(roles.proposer.preset).toEqual({
      value: "dangerous",
      source: "cli-global",
    });
  });

  it("falls back to role default when config preset omitted", () => {
    const config: CrossfireConfig = {
      ...baseConfig,
      roles: {
        proposer: { binding: "claude-main" },
        challenger: { binding: "codex-main" },
      },
    };
    const roles = resolveAllRoles(config, {});
    expect(roles.proposer.preset).toEqual({
      value: "guarded",
      source: "role-default",
    });
    expect(roles.judge?.preset).toEqual({
      value: "plan",
      source: "role-default",
    });
  });

  it("throws on invalid binding reference", () => {
    const config: CrossfireConfig = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        proposer: { binding: "nonexistent" },
      },
    };
    expect(() => resolveAllRoles(config, {})).toThrow(/binding.*nonexistent/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && npx vitest run __tests__/config/resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement loader and resolver**

```ts
// packages/cli/src/config/loader.ts
import { existsSync, readFileSync } from "node:fs";
import { type CrossfireConfig, CrossfireConfigSchema } from "./schema.js";

export function loadConfig(filePath: string): CrossfireConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Try YAML if available, otherwise re-throw as JSON error
    throw new Error(`Config parse error (${filePath}): expected valid JSON`);
  }
  const result = CrossfireConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Config validation failed (${filePath}): ${issues}`);
  }
  const config = result.data;
  validateReferences(config);
  return config;
}

function validateReferences(config: CrossfireConfig): void {
  const bindingNames = new Set(config.providerBindings.map((b) => b.name));
  const mcpNames = new Set(Object.keys(config.mcpServers ?? {}));

  for (const [roleName, roleConfig] of Object.entries(config.roles)) {
    if (!roleConfig) continue;
    if (!bindingNames.has(roleConfig.binding)) {
      throw new Error(
        `Role "${roleName}" references binding "${roleConfig.binding}" which does not exist. ` +
          `Available bindings: ${[...bindingNames].join(", ")}`,
      );
    }
  }
  for (const binding of config.providerBindings) {
    for (const serverName of binding.mcpServers ?? []) {
      if (!mcpNames.has(serverName)) {
        throw new Error(
          `Provider binding "${binding.name}" references MCP server "${serverName}" which does not exist. ` +
            `Available servers: ${[...mcpNames].join(", ")}`,
        );
      }
    }
  }
}
```

```ts
// packages/cli/src/config/resolver.ts
import type { PolicyPreset } from "@crossfire/adapter-core";
import type { PresetSource } from "./policy-resolution.js";
import { resolveRolePreset } from "./policy-resolution.js";
import type { CrossfireConfig, ProviderBindingConfig } from "./schema.js";

export type AdapterType = "claude" | "codex" | "gemini";

export interface ResolvedRoleRuntimeConfig {
  role: "proposer" | "challenger" | "judge";
  adapter: AdapterType;
  bindingName: string;
  model?: string;
  preset: {
    value: PolicyPreset;
    source: PresetSource;
  };
  systemPrompt?: string;
  providerOptions?: Record<string, unknown>;
  mcpServers?: string[];
}

export interface ResolvedAllRoles {
  proposer: ResolvedRoleRuntimeConfig;
  challenger: ResolvedRoleRuntimeConfig;
  judge?: ResolvedRoleRuntimeConfig;
}

export interface CliPresetOverrides {
  cliGlobalPreset?: PolicyPreset;
  cliProposerPreset?: PolicyPreset;
  cliChallengerPreset?: PolicyPreset;
  cliJudgePreset?: PolicyPreset;
}

export function resolveAllRoles(
  config: CrossfireConfig,
  cliOverrides: CliPresetOverrides,
): ResolvedAllRoles {
  const bindingMap = new Map(
    config.providerBindings.map((b) => [b.name, b]),
  );

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

    const cliRolePreset =
      roleName === "proposer"
        ? cliOverrides.cliProposerPreset
        : roleName === "challenger"
          ? cliOverrides.cliChallengerPreset
          : cliOverrides.cliJudgePreset;

    const preset = resolveRolePreset({
      role: roleName,
      configPreset: roleConfig.preset,
      cliRolePreset,
      cliGlobalPreset: cliOverrides.cliGlobalPreset,
    });

    return {
      role: roleName,
      adapter: binding.adapter,
      bindingName: binding.name,
      model: roleConfig.model ?? binding.model,
      preset: { value: preset.preset, source: preset.source },
      systemPrompt: roleConfig.systemPrompt,
      providerOptions: binding.providerOptions,
      mcpServers: binding.mcpServers,
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

```ts
// packages/cli/src/config/index.ts
export * from "./schema.js";
export * from "./loader.js";
export * from "./resolver.js";
export * from "./policy-resolution.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && npx vitest run __tests__/config/resolver.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/ packages/cli/__tests__/config/resolver.test.ts
git commit -m "feat(config): add config loader and resolver with binding validation"
```

---

## Task 4: Compiler Diagnostics

**Files:**
- Modify: `packages/adapter-core/src/policy/types.ts`
- Modify: `packages/adapter-core/src/policy/compiler.ts`
- Modify: `packages/adapter-core/src/policy/index.ts`
- Create: `packages/adapter-core/src/policy/observation-types.ts`
- Test: `packages/adapter-core/__tests__/policy/compiler-diagnostics.test.ts`

- [ ] **Step 1: Write failing tests for compiler diagnostics**

```ts
// packages/adapter-core/__tests__/policy/compiler-diagnostics.test.ts
import { describe, expect, it } from "vitest";
import { compilePolicyWithDiagnostics } from "../../src/policy/compiler.js";
import { makeCompileInput } from "../../src/testing/index.js";

describe("compilePolicyWithDiagnostics", () => {
  it("returns empty clamps when no ceiling applies", () => {
    const result = compilePolicyWithDiagnostics(
      makeCompileInput({ preset: "guarded", role: "proposer" }),
    );
    expect(result.clamps).toEqual([]);
    expect(result.policy.preset).toBe("guarded");
  });

  it("records clamp when judge ceiling lowers dangerous capabilities", () => {
    const result = compilePolicyWithDiagnostics(
      makeCompileInput({ preset: "dangerous", role: "judge" }),
    );
    expect(result.clamps).toContainEqual({
      field: "capabilities.filesystem",
      before: "write",
      after: "read",
      reason: "role_ceiling",
    });
    expect(result.clamps).toContainEqual({
      field: "capabilities.network",
      before: "full",
      after: "search",
      reason: "role_ceiling",
    });
    expect(result.clamps).toContainEqual({
      field: "capabilities.shell",
      before: "exec",
      after: "off",
      reason: "role_ceiling",
    });
    expect(result.clamps).toContainEqual({
      field: "capabilities.subagents",
      before: "on",
      after: "off",
      reason: "role_ceiling",
    });
    expect(result.clamps).toHaveLength(4);
  });

  it("does not record clamp when ceiling matches preset value", () => {
    // research preset has filesystem=read, judge ceiling is also read
    const result = compilePolicyWithDiagnostics(
      makeCompileInput({ preset: "research", role: "judge" }),
    );
    expect(result.clamps).toEqual([]);
  });

  it("policy output matches compilePolicy output", async () => {
    const { compilePolicy } = await import("../../src/policy/compiler.js");
    const input = makeCompileInput({ preset: "dangerous", role: "judge" });
    const diag = compilePolicyWithDiagnostics(input);
    const plain = compilePolicy(input);
    expect(diag.policy).toEqual(plain);
  });

  it("clamp field uses structured path format", () => {
    const result = compilePolicyWithDiagnostics(
      makeCompileInput({ preset: "dangerous", role: "judge" }),
    );
    for (const clamp of result.clamps) {
      expect(clamp.field).toMatch(/^capabilities\./);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/adapter-core && npx vitest run __tests__/policy/compiler-diagnostics.test.ts`
Expected: FAIL — `compilePolicyWithDiagnostics` not found

- [ ] **Step 3: Add observation types**

```ts
// packages/adapter-core/src/policy/observation-types.ts
import type {
  FilesystemLevel,
  NetworkLevel,
  PolicyTranslationWarning,
  ResolvedPolicy,
  ShellLevel,
  SubagentLevel,
} from "./types.js";

export type CapabilityLevelValue =
  | FilesystemLevel
  | NetworkLevel
  | ShellLevel
  | SubagentLevel;

export type PolicyClampField =
  | "capabilities.filesystem"
  | "capabilities.network"
  | "capabilities.shell"
  | "capabilities.subagents";

export interface PolicyClampNote {
  readonly field: PolicyClampField;
  readonly before: CapabilityLevelValue;
  readonly after: CapabilityLevelValue;
  readonly reason: "role_ceiling";
}

export interface CompilePolicyDiagnostics {
  readonly policy: ResolvedPolicy;
  readonly clamps: readonly PolicyClampNote[];
}

export type ToolSource = "builtin" | "mcp" | "provider-packaged" | "unknown";
export type ToolStatus = "allowed" | "blocked" | "degraded" | "unknown";
export type ToolReason =
  | "capability_policy"
  | "role_ceiling"
  | "legacy_override"
  | "provider_limitation"
  | "adapter_default"
  | "unknown";

export interface ToolInspectionRecord {
  readonly name: string;
  readonly source: ToolSource;
  readonly status: ToolStatus;
  readonly reason: ToolReason;
  readonly capabilityField?: string;
  readonly details?: string;
}

export type CapabilityEffectStatus =
  | "applied"
  | "approximated"
  | "not_implemented";

export interface CapabilityEffectRecord {
  readonly field: string;
  readonly status: CapabilityEffectStatus;
  readonly details?: string;
}

export interface PolicyTranslationSummary {
  readonly adapter: string;
  readonly nativeSummary: Record<string, unknown>;
  readonly exactFields: readonly string[];
  readonly approximateFields: readonly string[];
  readonly unsupportedFields: readonly string[];
}

export type ObservationCompleteness = "full" | "partial" | "minimal";

export interface ProviderObservationResult {
  readonly translation: PolicyTranslationSummary;
  readonly toolView: readonly ToolInspectionRecord[];
  readonly capabilityEffects: readonly CapabilityEffectRecord[];
  readonly warnings: readonly PolicyTranslationWarning[];
  readonly completeness: ObservationCompleteness;
}
```

- [ ] **Step 4: Implement compilePolicyWithDiagnostics**

Refactor `packages/adapter-core/src/policy/compiler.ts` — extract `compilePolicyInternal()` that returns `CompilePolicyDiagnostics`:

```ts
// packages/adapter-core/src/policy/compiler.ts
import {
  clampFilesystem,
  clampNetwork,
  clampShell,
  clampSubagents,
} from "./level-order.js";
import type { CompilePolicyDiagnostics, PolicyClampNote } from "./observation-types.js";
import { PRESET_EXPANSIONS } from "./presets.js";
import { DEFAULT_ROLE_CONTRACTS } from "./role-contracts.js";
import type {
  CapabilityCeilings,
  CapabilityPolicy,
  CompilePolicyInput,
  LegacyToolPolicyInput,
  ResolvedPolicy,
  RoleContract,
} from "./types.js";

function copyRoleContract(rc: RoleContract): RoleContract {
  return {
    semantics: { ...rc.semantics },
    ceilings: { ...rc.ceilings },
  };
}

function clampCapabilitiesWithNotes(
  base: Omit<CapabilityPolicy, "legacyToolOverrides">,
  ceilings: CapabilityCeilings,
): {
  capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">;
  clamps: PolicyClampNote[];
} {
  const clamps: PolicyClampNote[] = [];

  const filesystem = clampFilesystem(base.filesystem, ceilings.filesystem);
  if (filesystem !== base.filesystem) {
    clamps.push({
      field: "capabilities.filesystem",
      before: base.filesystem,
      after: filesystem,
      reason: "role_ceiling",
    });
  }

  const network = clampNetwork(base.network, ceilings.network);
  if (network !== base.network) {
    clamps.push({
      field: "capabilities.network",
      before: base.network,
      after: network,
      reason: "role_ceiling",
    });
  }

  const shell = clampShell(base.shell, ceilings.shell);
  if (shell !== base.shell) {
    clamps.push({
      field: "capabilities.shell",
      before: base.shell,
      after: shell,
      reason: "role_ceiling",
    });
  }

  const subagents = clampSubagents(base.subagents, ceilings.subagents);
  if (subagents !== base.subagents) {
    clamps.push({
      field: "capabilities.subagents",
      before: base.subagents,
      after: subagents,
      reason: "role_ceiling",
    });
  }

  return { capabilities: { filesystem, network, shell, subagents }, clamps };
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

function compilePolicyInternal(
  input: CompilePolicyInput,
): CompilePolicyDiagnostics {
  const { preset, role, legacyToolPolicy } = input;

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

  return {
    policy: {
      preset,
      roleContract,
      capabilities,
      interaction: presetExpansion.interaction,
    },
    clamps,
  };
}

export function compilePolicy(input: CompilePolicyInput): ResolvedPolicy {
  return compilePolicyInternal(input).policy;
}

export function compilePolicyWithDiagnostics(
  input: CompilePolicyInput,
): CompilePolicyDiagnostics {
  return compilePolicyInternal(input);
}
```

- [ ] **Step 5: Update exports**

Add to `packages/adapter-core/src/policy/index.ts`:
```ts
export * from "./observation-types.js";
```

- [ ] **Step 6: Run all policy tests to ensure no regressions**

Run: `cd packages/adapter-core && npx vitest run __tests__/policy/`
Expected: All existing tests PASS + new diagnostics tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-core/src/policy/
git add packages/adapter-core/__tests__/policy/compiler-diagnostics.test.ts
git commit -m "feat(policy): add compilePolicyWithDiagnostics with clamp notes"
```

---

## Task 5: Claude Adapter Observation — Shared Rule Helpers

**Files:**
- Create: `packages/adapter-claude/src/policy-observation.ts`
- Modify: `packages/adapter-claude/src/policy-translation.ts`
- Test: `packages/adapter-claude/__tests__/policy-observation.test.ts`

- [ ] **Step 1: Write failing tests for Claude observation**

```ts
// packages/adapter-claude/__tests__/policy-observation.test.ts
import { describe, expect, it } from "vitest";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Claude inspectPolicy", () => {
  it("returns partial completeness", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    expect(result.completeness).toBe("partial");
  });

  it("reports known builtin tools", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    const toolNames = result.toolView.map((t) => t.name);
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("WebFetch");
  });

  it("blocks shell tools when shell=off", () => {
    const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
    const result = inspectPolicy(policy);
    const bash = result.toolView.find((t) => t.name === "Bash");
    expect(bash?.status).toBe("blocked");
    expect(bash?.reason).toBe("capability_policy");
    expect(bash?.source).toBe("builtin");
  });

  it("allows shell tools when shell=exec", () => {
    const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
    const result = inspectPolicy(policy);
    const bash = result.toolView.find((t) => t.name === "Bash");
    expect(bash?.status).toBe("allowed");
  });

  it("includes capabilityEffects for all modeled dimensions", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    const fields = result.capabilityEffects.map((e) => e.field);
    expect(fields).toContain("capabilities.filesystem");
    expect(fields).toContain("capabilities.shell");
    expect(fields).toContain("capabilities.network");
    expect(fields).toContain("capabilities.subagents");
  });

  describe("consistency with translatePolicy", () => {
    it("warnings are consistent under same policy", () => {
      const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
      const observation = inspectPolicy(policy);
      const translation = translatePolicy(policy);
      // observation warnings are superset of translation warnings
      for (const tw of translation.warnings) {
        const found = observation.warnings.some(
          (ow) =>
            ow.field === tw.field &&
            ow.adapter === tw.adapter &&
            ow.reason === tw.reason,
        );
        expect(found, `Missing observation warning for ${tw.field}`).toBe(true);
      }
    });

    it("translation summary matches native permissionMode", () => {
      const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
      const observation = inspectPolicy(policy);
      const translation = translatePolicy(policy);
      expect(observation.translation.nativeSummary.permissionMode).toBe(
        translation.native.permissionMode,
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/adapter-claude && npx vitest run __tests__/policy-observation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Extract shared rule helpers and implement inspectPolicy**

```ts
// packages/adapter-claude/src/policy-observation.ts
import type {
  CapabilityEffectRecord,
  CapabilityPolicy,
  ObservationCompleteness,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  ProviderObservationResult,
  ResolvedPolicy,
  ToolInspectionRecord,
} from "@crossfire/adapter-core";
import type { ClaudePermissionMode } from "./types.js";

// --- Shared constants (also used by policy-translation.ts) ---

export const CLAUDE_SHELL_TOOLS = ["Bash"];
export const CLAUDE_FILESYSTEM_ALL_TOOLS = [
  "Read", "Edit", "Write", "Glob", "Grep", "LS",
];
export const CLAUDE_FILESYSTEM_WRITE_TOOLS = ["Edit", "Write"];
export const CLAUDE_NETWORK_TOOLS = ["WebFetch"];
export const CLAUDE_SUBAGENT_TOOLS = ["Task"];

export const CLAUDE_ALL_KNOWN_TOOLS = [
  ...CLAUDE_SHELL_TOOLS,
  ...CLAUDE_FILESYSTEM_ALL_TOOLS,
  ...CLAUDE_NETWORK_TOOLS,
  ...CLAUDE_SUBAGENT_TOOLS,
];

// --- Shared rule helpers ---

export function isPlanShape(policy: ResolvedPolicy): boolean {
  const { capabilities: c, interaction: i } = policy;
  return (
    i.approval === "always" &&
    (c.filesystem === "off" || c.filesystem === "read") &&
    c.shell === "off" &&
    c.subagents === "off" &&
    (c.network === "off" || c.network === "search")
  );
}

export interface ApprovalResolution {
  permissionMode: ClaudePermissionMode;
  allowDangerouslySkipPermissions?: boolean;
  warnings: PolicyTranslationWarning[];
}

export function resolveApproval(policy: ResolvedPolicy): ApprovalResolution {
  const warnings: PolicyTranslationWarning[] = [];
  if (isPlanShape(policy)) {
    return { permissionMode: "plan", warnings };
  }
  switch (policy.interaction.approval) {
    case "never":
      return {
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        warnings,
      };
    case "on-risk":
      return { permissionMode: "default", warnings };
    case "always":
      warnings.push({
        field: "interaction.approval",
        adapter: "claude",
        reason: "approximate",
        message: "Claude has no per-tool-must-approve mode; mapped to default",
      });
      return { permissionMode: "default", warnings };
    case "on-failure":
      warnings.push({
        field: "interaction.approval",
        adapter: "claude",
        reason: "approximate",
        message: "Claude has no on-failure approval; mapped to default",
      });
      return { permissionMode: "default", warnings };
  }
}

export function computeBaseDenyList(capabilities: CapabilityPolicy): string[] {
  const deny: string[] = [];
  if (capabilities.shell === "off") deny.push(...CLAUDE_SHELL_TOOLS);
  if (capabilities.filesystem === "off")
    deny.push(...CLAUDE_FILESYSTEM_ALL_TOOLS);
  else if (capabilities.filesystem === "read")
    deny.push(...CLAUDE_FILESYSTEM_WRITE_TOOLS);
  if (capabilities.network === "off") deny.push(...CLAUDE_NETWORK_TOOLS);
  if (capabilities.subagents === "off") deny.push(...CLAUDE_SUBAGENT_TOOLS);
  return deny;
}

export function resolveCapabilityEffects(
  policy: ResolvedPolicy,
): CapabilityEffectRecord[] {
  const effects: CapabilityEffectRecord[] = [];
  effects.push({
    field: "capabilities.filesystem",
    status: "applied",
    details: `filesystem=${policy.capabilities.filesystem}`,
  });
  effects.push({
    field: "capabilities.shell",
    status: "applied",
    details: `shell=${policy.capabilities.shell}`,
  });
  effects.push({
    field: "capabilities.network",
    status: "applied",
    details: `network=${policy.capabilities.network}`,
  });
  effects.push({
    field: "capabilities.subagents",
    status: "applied",
    details: `subagents=${policy.capabilities.subagents}`,
  });
  return effects;
}

export function resolveToolView(
  policy: ResolvedPolicy,
): ToolInspectionRecord[] {
  const denyList = new Set(computeBaseDenyList(policy.capabilities));
  return CLAUDE_ALL_KNOWN_TOOLS.map((name): ToolInspectionRecord => {
    const blocked = denyList.has(name);
    return {
      name,
      source: "builtin",
      status: blocked ? "blocked" : "allowed",
      reason: blocked ? "capability_policy" : "adapter_default",
      ...(blocked ? { capabilityField: inferCapabilityField(name) } : {}),
    };
  });
}

function inferCapabilityField(toolName: string): string {
  if (CLAUDE_SHELL_TOOLS.includes(toolName)) return "capabilities.shell";
  if (
    CLAUDE_FILESYSTEM_ALL_TOOLS.includes(toolName) ||
    CLAUDE_FILESYSTEM_WRITE_TOOLS.includes(toolName)
  )
    return "capabilities.filesystem";
  if (CLAUDE_NETWORK_TOOLS.includes(toolName)) return "capabilities.network";
  if (CLAUDE_SUBAGENT_TOOLS.includes(toolName)) return "capabilities.subagents";
  return "unknown";
}

export function classifyCompleteness(): ObservationCompleteness {
  return "partial";
}

export function buildLimitsWarnings(
  limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
  const warnings: PolicyTranslationWarning[] = [];
  if (!limits) return warnings;
  if (limits.maxToolCalls !== undefined)
    warnings.push({
      field: "interaction.limits.maxToolCalls",
      adapter: "claude",
      reason: "not_implemented",
      message: "Claude does not support maxToolCalls limit",
    });
  if (limits.timeoutMs !== undefined)
    warnings.push({
      field: "interaction.limits.timeoutMs",
      adapter: "claude",
      reason: "not_implemented",
      message: "Claude does not support timeoutMs limit",
    });
  if (limits.budgetUsd !== undefined)
    warnings.push({
      field: "interaction.limits.budgetUsd",
      adapter: "claude",
      reason: "not_implemented",
      message: "Claude does not support budgetUsd limit",
    });
  return warnings;
}

// --- inspectPolicy (Layer 3) ---

export function inspectPolicy(
  policy: ResolvedPolicy,
): ProviderObservationResult {
  const approval = resolveApproval(policy);
  const capabilityEffects = resolveCapabilityEffects(policy);
  const toolView = resolveToolView(policy);
  const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

  const allWarnings = [...approval.warnings, ...limitsWarnings];

  const translation: PolicyTranslationSummary = {
    adapter: "claude",
    nativeSummary: {
      permissionMode: approval.permissionMode,
      maxTurns: policy.interaction.limits?.maxTurns,
    },
    exactFields: approval.warnings.length === 0
      ? ["interaction.approval"]
      : [],
    approximateFields: approval.warnings
      .filter((w) => w.reason === "approximate")
      .map((w) => w.field),
    unsupportedFields: limitsWarnings.map((w) => w.field),
  };

  return {
    translation,
    toolView,
    capabilityEffects,
    warnings: allWarnings,
    completeness: classifyCompleteness(),
  };
}
```

- [ ] **Step 4: Refactor translatePolicy to use shared helpers**

Update `packages/adapter-claude/src/policy-translation.ts` to import from `policy-observation.ts`:

```ts
// packages/adapter-claude/src/policy-translation.ts
import type {
  CapabilityPolicy,
  PolicyTranslationWarning,
  ProviderTranslationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
  buildLimitsWarnings,
  computeBaseDenyList,
  resolveApproval,
} from "./policy-observation.js";

export interface ClaudeNativeOptions {
  permissionMode: string;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
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
  const effectiveDeny = [...baseDeny, ...(deny ?? [])];
  return {
    ...(effectiveAllow?.length ? { allowedTools: effectiveAllow } : {}),
    ...(effectiveDeny.length ? { disallowedTools: effectiveDeny } : {}),
  };
}

export function translatePolicy(
  policy: ResolvedPolicy,
): ProviderTranslationResult<ClaudeNativeOptions> {
  const approval = resolveApproval(policy);
  const warnings: PolicyTranslationWarning[] = [...approval.warnings];
  const toolPolicy = buildToolPolicy(policy.capabilities, warnings);
  const maxTurns = policy.interaction.limits?.maxTurns;
  warnings.push(...buildLimitsWarnings(policy.interaction.limits));
  return {
    native: {
      permissionMode: approval.permissionMode,
      maxTurns,
      ...toolPolicy,
      ...(approval.allowDangerouslySkipPermissions
        ? { allowDangerouslySkipPermissions: true }
        : {}),
    },
    warnings,
  };
}
```

- [ ] **Step 5: Run ALL Claude adapter tests (translation + observation)**

Run: `cd packages/adapter-claude && npx vitest run`
Expected: All existing translation tests PASS + new observation tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude/src/policy-observation.ts
git add packages/adapter-claude/src/policy-translation.ts
git add packages/adapter-claude/__tests__/policy-observation.test.ts
git commit -m "feat(claude): add policy observation with shared rule helpers"
```

---

## Task 6: Codex and Gemini Adapter Observation

**Files:**
- Create: `packages/adapter-codex/src/policy-observation.ts`
- Modify: `packages/adapter-codex/src/policy-translation.ts`
- Create: `packages/adapter-gemini/src/policy-observation.ts`
- Modify: `packages/adapter-gemini/src/policy-translation.ts`
- Test: `packages/adapter-codex/__tests__/policy-observation.test.ts`
- Test: `packages/adapter-gemini/__tests__/policy-observation.test.ts`

- [ ] **Step 1: Write failing tests for Codex observation**

```ts
// packages/adapter-codex/__tests__/policy-observation.test.ts
import { describe, expect, it } from "vitest";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Codex inspectPolicy", () => {
  it("returns minimal completeness", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    expect(result.completeness).toBe("minimal");
  });

  it("toolView is empty (Codex has no discrete tool surface)", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    expect(result.toolView).toEqual([]);
  });

  it("reports sandbox-level capability effects", () => {
    const policy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });
    const result = inspectPolicy(policy);
    const sandboxEffect = result.capabilityEffects.find(
      (e) => e.field === "sandbox",
    );
    expect(sandboxEffect).toBeDefined();
    expect(sandboxEffect?.status).toBe("applied");
  });

  describe("consistency with translatePolicy", () => {
    it("warnings are superset of translation warnings", () => {
      const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
      const observation = inspectPolicy(policy);
      const translation = translatePolicy(policy);
      for (const tw of translation.warnings) {
        const found = observation.warnings.some(
          (ow) => ow.field === tw.field && ow.reason === tw.reason,
        );
        expect(found, `Missing warning for ${tw.field}`).toBe(true);
      }
    });
  });
});
```

- [ ] **Step 2: Write failing tests for Gemini observation**

```ts
// packages/adapter-gemini/__tests__/policy-observation.test.ts
import { describe, expect, it } from "vitest";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";
import { inspectPolicy } from "../src/policy-observation.js";
import { translatePolicy } from "../src/policy-translation.js";

describe("Gemini inspectPolicy", () => {
  it("returns minimal completeness", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    expect(result.completeness).toBe("minimal");
  });

  it("toolView is empty", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    expect(result.toolView).toEqual([]);
  });

  it("reports approval capability effect", () => {
    const policy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
    const result = inspectPolicy(policy);
    const approvalEffect = result.capabilityEffects.find(
      (e) => e.field === "interaction.approval",
    );
    expect(approvalEffect).toBeDefined();
  });

  describe("consistency with translatePolicy", () => {
    it("translation summary matches native approvalMode", () => {
      const policy = makeResolvedPolicy({ preset: "research", role: "proposer" });
      const observation = inspectPolicy(policy);
      const translation = translatePolicy(policy);
      expect(observation.translation.nativeSummary.approvalMode).toBe(
        translation.native.approvalMode,
      );
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/adapter-codex && npx vitest run __tests__/policy-observation.test.ts`
Run: `cd packages/adapter-gemini && npx vitest run __tests__/policy-observation.test.ts`
Expected: Both FAIL

- [ ] **Step 4: Implement Codex observation**

```ts
// packages/adapter-codex/src/policy-observation.ts
import type {
  CapabilityEffectRecord,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  ProviderObservationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";

export function resolveApproval(
  approval: ResolvedPolicy["interaction"]["approval"],
): {
  approvalPolicy: "on-request" | "on-failure" | "never";
  warnings: PolicyTranslationWarning[];
} {
  const warnings: PolicyTranslationWarning[] = [];
  switch (approval) {
    case "on-failure":
      return { approvalPolicy: "on-failure", warnings };
    case "never":
      return { approvalPolicy: "never", warnings };
    case "on-risk":
      warnings.push({
        field: "interaction.approval",
        adapter: "codex",
        reason: "approximate",
        message: "Codex has no on-risk approval; mapped to on-request",
      });
      return { approvalPolicy: "on-request", warnings };
    case "always":
      warnings.push({
        field: "interaction.approval",
        adapter: "codex",
        reason: "approximate",
        message: "Codex has no always-approve mode; mapped to on-request",
      });
      return { approvalPolicy: "on-request", warnings };
  }
}

export function resolveSandboxLevel(
  policy: ResolvedPolicy,
): { level: string; warnings: PolicyTranslationWarning[] } {
  const warnings: PolicyTranslationWarning[] = [];
  let level = "readOnly";
  if (policy.capabilities.filesystem === "write") level = "workspace-write";
  if (policy.capabilities.shell === "exec") level = "danger-full-access";
  if (policy.capabilities.network === "full") {
    level = "danger-full-access";
    warnings.push({
      field: "capabilities.network",
      adapter: "codex",
      reason: "approximate",
      message: "Codex full network requires danger-full-access sandbox",
    });
  }
  return { level, warnings };
}

export function resolveCapabilityEffects(
  policy: ResolvedPolicy,
  sandboxLevel: string,
): CapabilityEffectRecord[] {
  return [
    {
      field: "sandbox",
      status: "applied",
      details: `sandbox=${sandboxLevel}`,
    },
    {
      field: "capabilities.network",
      status: policy.capabilities.network === "off" ? "applied" : "approximated",
      details: `networkDisabled=${policy.capabilities.network === "off"}`,
    },
  ];
}

export function buildLimitsWarnings(
  limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
  const warnings: PolicyTranslationWarning[] = [];
  if (!limits) return warnings;
  for (const [key, value] of Object.entries(limits)) {
    if (value !== undefined) {
      warnings.push({
        field: `interaction.limits.${key}`,
        adapter: "codex",
        reason: "not_implemented",
        message: `Codex does not support ${key} limit`,
      });
    }
  }
  return warnings;
}

export function inspectPolicy(
  policy: ResolvedPolicy,
): ProviderObservationResult {
  const approval = resolveApproval(policy.interaction.approval);
  const sandbox = resolveSandboxLevel(policy);
  const capabilityEffects = resolveCapabilityEffects(policy, sandbox.level);
  const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);
  const legacyWarnings: PolicyTranslationWarning[] = [];
  if (policy.capabilities.legacyToolOverrides) {
    legacyWarnings.push({
      field: "capabilities.legacyToolOverrides",
      adapter: "codex",
      reason: "not_implemented",
      message: "Codex does not consume per-tool allow/deny lists",
    });
  }

  const allWarnings = [
    ...approval.warnings,
    ...sandbox.warnings,
    ...legacyWarnings,
    ...limitsWarnings,
  ];

  return {
    translation: {
      adapter: "codex",
      nativeSummary: {
        approvalPolicy: approval.approvalPolicy,
        sandboxPolicy: sandbox.level,
        networkDisabled: policy.capabilities.network === "off",
      },
      exactFields: approval.warnings.length === 0
        ? ["interaction.approval"]
        : [],
      approximateFields: allWarnings
        .filter((w) => w.reason === "approximate")
        .map((w) => w.field),
      unsupportedFields: allWarnings
        .filter((w) => w.reason === "not_implemented")
        .map((w) => w.field),
    },
    toolView: [],
    capabilityEffects,
    warnings: allWarnings,
    completeness: "minimal",
  };
}
```

- [ ] **Step 5: Implement Gemini observation**

```ts
// packages/adapter-gemini/src/policy-observation.ts
import type {
  CapabilityEffectRecord,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  ProviderObservationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";

export function isPlanShape(policy: ResolvedPolicy): boolean {
  const { capabilities: c, interaction: i } = policy;
  return (
    i.approval === "always" &&
    (c.filesystem === "off" || c.filesystem === "read") &&
    c.shell === "off" &&
    c.subagents === "off" &&
    (c.network === "off" || c.network === "search")
  );
}

export function resolveApproval(
  policy: ResolvedPolicy,
): {
  approvalMode: "default" | "auto_edit" | "plan" | "yolo";
  warnings: PolicyTranslationWarning[];
} {
  const warnings: PolicyTranslationWarning[] = [];
  if (isPlanShape(policy)) return { approvalMode: "plan", warnings };
  switch (policy.interaction.approval) {
    case "on-risk":
      return { approvalMode: "default", warnings };
    case "on-failure":
      warnings.push({
        field: "interaction.approval",
        adapter: "gemini",
        reason: "approximate",
        message: "Gemini has no on-failure mode; mapped to auto_edit",
      });
      return { approvalMode: "auto_edit", warnings };
    case "never":
      warnings.push({
        field: "interaction.approval",
        adapter: "gemini",
        reason: "approximate",
        message: "Gemini yolo is CLI-only; may not be settable at runtime",
      });
      return { approvalMode: "yolo", warnings };
    case "always":
      warnings.push({
        field: "interaction.approval",
        adapter: "gemini",
        reason: "approximate",
        message: "Gemini has no always-approve mode; mapped to default",
      });
      return { approvalMode: "default", warnings };
  }
}

export function resolveCapabilityEffects(
  policy: ResolvedPolicy,
): { effects: CapabilityEffectRecord[]; warnings: PolicyTranslationWarning[] } {
  const effects: CapabilityEffectRecord[] = [];
  const warnings: PolicyTranslationWarning[] = [];

  effects.push({
    field: "interaction.approval",
    status: "applied",
    details: `approvalMode resolved from approval=${policy.interaction.approval}`,
  });

  if (policy.capabilities.filesystem === "off") {
    effects.push({
      field: "capabilities.filesystem",
      status: "not_implemented",
      details: "Gemini CLI does not support disabling filesystem access",
    });
    warnings.push({
      field: "capabilities.filesystem",
      adapter: "gemini",
      reason: "not_implemented",
      message: "Gemini CLI does not support disabling filesystem access",
    });
  }
  if (policy.capabilities.network === "off") {
    effects.push({
      field: "capabilities.network",
      status: "not_implemented",
      details: "Gemini CLI does not support disabling network access",
    });
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

  return { effects, warnings };
}

export function buildLimitsWarnings(
  limits: ResolvedPolicy["interaction"]["limits"],
): PolicyTranslationWarning[] {
  const warnings: PolicyTranslationWarning[] = [];
  if (!limits) return warnings;
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
  return warnings;
}

export function inspectPolicy(
  policy: ResolvedPolicy,
): ProviderObservationResult {
  const approval = resolveApproval(policy);
  const capabilities = resolveCapabilityEffects(policy);
  const limitsWarnings = buildLimitsWarnings(policy.interaction.limits);

  const allWarnings = [
    ...approval.warnings,
    ...capabilities.warnings,
    ...limitsWarnings,
  ];

  return {
    translation: {
      adapter: "gemini",
      nativeSummary: { approvalMode: approval.approvalMode },
      exactFields: approval.warnings.length === 0
        ? ["interaction.approval"]
        : [],
      approximateFields: allWarnings
        .filter((w) => w.reason === "approximate")
        .map((w) => w.field),
      unsupportedFields: allWarnings
        .filter((w) => w.reason === "not_implemented")
        .map((w) => w.field),
    },
    toolView: [],
    capabilityEffects: capabilities.effects,
    warnings: allWarnings,
    completeness: "minimal",
  };
}
```

- [ ] **Step 6: Refactor Codex translatePolicy to use shared helpers**

Update `packages/adapter-codex/src/policy-translation.ts` to import from `policy-observation.ts`:

```ts
// packages/adapter-codex/src/policy-translation.ts
import type {
  PolicyTranslationWarning,
  ProviderTranslationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
  buildLimitsWarnings,
  resolveApproval,
  resolveSandboxLevel,
} from "./policy-observation.js";

export interface CodexNativeOptions {
  approvalPolicy: "on-request" | "on-failure" | "never";
  sandboxPolicy: string;
  networkDisabled: boolean;
}

export function translatePolicy(
  policy: ResolvedPolicy,
): ProviderTranslationResult<CodexNativeOptions> {
  const approval = resolveApproval(policy.interaction.approval);
  const sandbox = resolveSandboxLevel(policy);
  const warnings: PolicyTranslationWarning[] = [
    ...approval.warnings,
    ...sandbox.warnings,
  ];
  if (policy.capabilities.legacyToolOverrides) {
    warnings.push({
      field: "capabilities.legacyToolOverrides",
      adapter: "codex",
      reason: "not_implemented",
      message: "Codex does not consume per-tool allow/deny lists",
    });
  }
  warnings.push(...buildLimitsWarnings(policy.interaction.limits));
  return {
    native: {
      approvalPolicy: approval.approvalPolicy,
      sandboxPolicy: sandbox.level,
      networkDisabled: policy.capabilities.network === "off",
    },
    warnings,
  };
}
```

- [ ] **Step 6b: Refactor Gemini translatePolicy to use shared helpers**

Update `packages/adapter-gemini/src/policy-translation.ts` to import from `policy-observation.ts`:

```ts
// packages/adapter-gemini/src/policy-translation.ts
import type {
  PolicyTranslationWarning,
  ProviderTranslationResult,
  ResolvedPolicy,
} from "@crossfire/adapter-core";
import {
  buildLimitsWarnings,
  resolveApproval,
  resolveCapabilityEffects,
} from "./policy-observation.js";

export interface GeminiNativeOptions {
  approvalMode: "default" | "auto_edit" | "plan" | "yolo";
}

export function translatePolicy(
  policy: ResolvedPolicy,
): ProviderTranslationResult<GeminiNativeOptions> {
  const approval = resolveApproval(policy);
  const capabilities = resolveCapabilityEffects(policy);
  const warnings: PolicyTranslationWarning[] = [
    ...approval.warnings,
    ...capabilities.warnings,
  ];
  if (policy.capabilities.legacyToolOverrides) {
    warnings.push({
      field: "capabilities.legacyToolOverrides",
      adapter: "gemini",
      reason: "not_implemented",
      message: "Gemini does not consume per-tool allow/deny lists",
    });
  }
  warnings.push(...buildLimitsWarnings(policy.interaction.limits));
  return {
    native: { approvalMode: approval.approvalMode },
    warnings,
  };
}
```

- [ ] **Step 7: Run all adapter tests**

Run: `pnpm --filter @crossfire/adapter-codex test && pnpm --filter @crossfire/adapter-gemini test`
Expected: All existing + new tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-codex/src/policy-observation.ts packages/adapter-codex/src/policy-translation.ts
git add packages/adapter-codex/__tests__/policy-observation.test.ts
git add packages/adapter-gemini/src/policy-observation.ts packages/adapter-gemini/src/policy-translation.ts
git add packages/adapter-gemini/__tests__/policy-observation.test.ts
git commit -m "feat(codex,gemini): add policy observation with shared rule helpers"
```

---

## Task 7: Preset Options CLI Parser

**Files:**
- Create: `packages/cli/src/commands/preset-options.ts`
- Test: `packages/cli/__tests__/commands/preset-options.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/cli/__tests__/commands/preset-options.test.ts
import { describe, expect, it } from "vitest";
import {
  buildPresetConfig,
  parsePresetValue,
  parseTurnPresets,
} from "../../src/commands/preset-options.js";

describe("parsePresetValue", () => {
  it("accepts valid presets", () => {
    expect(parsePresetValue("research", "--preset")).toBe("research");
    expect(parsePresetValue("guarded", "--preset")).toBe("guarded");
    expect(parsePresetValue("dangerous", "--preset")).toBe("dangerous");
    expect(parsePresetValue("plan", "--preset")).toBe("plan");
  });

  it("throws on invalid preset", () => {
    expect(() => parsePresetValue("invalid", "--preset")).toThrow(
      /must be one of/,
    );
  });
});

describe("parseTurnPresets", () => {
  it("parses turnId=preset pairs", () => {
    const result = parseTurnPresets(["p-1=plan", "c-2=dangerous"]);
    expect(result).toEqual({ "p-1": "plan", "c-2": "dangerous" });
  });

  it("throws on malformed entry", () => {
    expect(() => parseTurnPresets(["bad"])).toThrow(/must look like/);
  });
});

describe("buildPresetConfig", () => {
  it("returns undefined when no options given", () => {
    expect(buildPresetConfig({})).toBeUndefined();
  });

  it("builds config with global preset", () => {
    const result = buildPresetConfig({ preset: "dangerous" });
    expect(result?.globalPreset).toBe("dangerous");
  });

  it("builds config with role-specific presets", () => {
    const result = buildPresetConfig({
      proposerPreset: "research",
      challengerPreset: "guarded",
    });
    expect(result?.rolePresets?.proposer).toBe("research");
    expect(result?.rolePresets?.challenger).toBe("guarded");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && npx vitest run __tests__/commands/preset-options.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement preset options parser**

```ts
// packages/cli/src/commands/preset-options.ts
import type { PolicyPreset } from "@crossfire/adapter-core";

const VALID_PRESETS = new Set<PolicyPreset>([
  "research",
  "guarded",
  "dangerous",
  "plan",
]);

export function parsePresetValue(value: string, label: string): PolicyPreset {
  if (VALID_PRESETS.has(value as PolicyPreset)) {
    return value as PolicyPreset;
  }
  throw new Error(
    `${label} must be one of: research, guarded, dangerous, plan`,
  );
}

export function parseTurnPresets(
  entries: string[],
): Record<string, PolicyPreset> {
  return Object.fromEntries(
    entries.map((entry) => {
      const [turnId, preset] = entry.split("=", 2);
      if (!turnId || !preset) {
        throw new Error(
          `--turn-preset entries must look like <turnId>=<preset>, received: ${entry}`,
        );
      }
      return [turnId, parsePresetValue(preset, `--turn-preset ${entry}`)];
    }),
  );
}

export interface PresetConfig {
  globalPreset?: PolicyPreset;
  rolePresets?: Partial<
    Record<"proposer" | "challenger" | "judge", PolicyPreset>
  >;
  turnPresets?: Record<string, PolicyPreset>;
}

export function buildPresetConfig(options: {
  preset?: string;
  proposerPreset?: string;
  challengerPreset?: string;
  judgePreset?: string;
  turnPreset?: string[];
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
  const turnPresets =
    options.turnPreset?.length ? parseTurnPresets(options.turnPreset) : undefined;

  if (
    !globalPreset &&
    !proposerPreset &&
    !challengerPreset &&
    !judgePreset &&
    !turnPresets
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
  };
}

export function collectOptionValues(
  value: string,
  previous: string[] = [],
): string[] {
  return [...previous, value];
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/cli && npx vitest run __tests__/commands/preset-options.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/preset-options.ts packages/cli/__tests__/commands/preset-options.test.ts
git commit -m "feat(cli): add preset-first CLI option parser"
```

---

## Task 8: Inspection Context and Commands

**Files:**
- Create: `packages/cli/src/commands/inspection-context.ts`
- Create: `packages/cli/src/commands/inspect-policy.ts`
- Create: `packages/cli/src/commands/inspect-tools.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/__tests__/commands/inspect-policy.test.ts`

This task implements the shared `buildInspectionContext()` pipeline and both inspection commands. Due to the size, tests focus on JSON output structure.

- [ ] **Step 1: Write failing tests for inspect-policy JSON output**

```ts
// packages/cli/__tests__/commands/inspect-policy.test.ts
import { describe, expect, it } from "vitest";
import { buildInspectionContext } from "../../src/commands/inspection-context.js";
import type { CrossfireConfig } from "../../src/config/schema.js";

const testConfig: CrossfireConfig = {
  providerBindings: [
    { name: "claude-test", adapter: "claude", model: "claude-sonnet" },
  ],
  roles: {
    proposer: { binding: "claude-test", preset: "guarded" },
    challenger: { binding: "claude-test", preset: "research" },
    judge: { binding: "claude-test", preset: "plan" },
  },
};

describe("buildInspectionContext", () => {
  it("produces inspection for all roles", () => {
    const context = buildInspectionContext(testConfig, {});
    expect(context).toHaveLength(3);
    const roles = context.map((c) => c.role);
    expect(roles).toContain("proposer");
    expect(roles).toContain("challenger");
    expect(roles).toContain("judge");
  });

  it("includes preset source and clamp notes", () => {
    const context = buildInspectionContext(testConfig, {});
    const proposer = context.find((c) => c.role === "proposer")!;
    expect(proposer.preset.source).toBe("config");
    expect(proposer.preset.value).toBe("guarded");
    expect(Array.isArray(proposer.clamps)).toBe(true);
  });

  it("judge has clamp notes when using dangerous preset", () => {
    const config: CrossfireConfig = {
      ...testConfig,
      roles: {
        ...testConfig.roles,
        judge: { binding: "claude-test", preset: "dangerous" },
      },
    };
    const context = buildInspectionContext(config, {});
    const judge = context.find((c) => c.role === "judge")!;
    expect(judge.clamps.length).toBeGreaterThan(0);
    expect(judge.clamps[0].reason).toBe("role_ceiling");
  });

  it("includes adapter observation result", () => {
    const context = buildInspectionContext(testConfig, {});
    const proposer = context.find((c) => c.role === "proposer")!;
    expect(proposer.observation).toBeDefined();
    expect(proposer.observation.completeness).toBe("partial");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && npx vitest run __tests__/commands/inspect-policy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement buildInspectionContext**

```ts
// packages/cli/src/commands/inspection-context.ts
import {
  type CompilePolicyDiagnostics,
  type PolicyClampNote,
  type ProviderObservationResult,
  type ResolvedPolicy,
  compilePolicyWithDiagnostics,
} from "@crossfire/adapter-core";
import { inspectPolicy as claudeInspect } from "@crossfire/adapter-claude/policy-observation";
import { inspectPolicy as codexInspect } from "@crossfire/adapter-codex/policy-observation";
import { inspectPolicy as geminiInspect } from "@crossfire/adapter-gemini/policy-observation";
import type { PresetSource } from "../config/policy-resolution.js";
import { resolveAllRoles, type CliPresetOverrides } from "../config/resolver.js";
import type { CrossfireConfig } from "../config/schema.js";
import type { PolicyPreset } from "@crossfire/adapter-core";

export interface RoleInspectionContext {
  role: "proposer" | "challenger" | "judge";
  adapter: string;
  model?: string;
  preset: {
    value: PolicyPreset;
    source: PresetSource;
  };
  resolvedPolicy: ResolvedPolicy;
  clamps: readonly PolicyClampNote[];
  observation: ProviderObservationResult;
  error?: { message: string };
}

const adapterInspectors = {
  claude: claudeInspect,
  codex: codexInspect,
  gemini: geminiInspect,
} as const;

export function buildInspectionContext(
  config: CrossfireConfig,
  cliOverrides: CliPresetOverrides,
): RoleInspectionContext[] {
  const roles = resolveAllRoles(config, cliOverrides);
  const results: RoleInspectionContext[] = [];

  for (const roleName of ["proposer", "challenger", "judge"] as const) {
    const resolved = roles[roleName];
    if (!resolved) continue;

    try {
      const diagnostics = compilePolicyWithDiagnostics({
        preset: resolved.preset.value,
        role: roleName,
      });

      const inspect = adapterInspectors[resolved.adapter];
      const observation = inspect(diagnostics.policy);

      results.push({
        role: roleName,
        adapter: resolved.adapter,
        model: resolved.model,
        preset: resolved.preset,
        resolvedPolicy: diagnostics.policy,
        clamps: diagnostics.clamps,
        observation,
      });
    } catch (err) {
      results.push({
        role: roleName,
        adapter: resolved.adapter,
        model: resolved.model,
        preset: resolved.preset,
        resolvedPolicy: undefined as unknown as ResolvedPolicy,
        clamps: [],
        observation: undefined as unknown as ProviderObservationResult,
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Implement inspect-policy command**

```ts
// packages/cli/src/commands/inspect-policy.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { buildInspectionContext, type RoleInspectionContext } from "./inspection-context.js";
import { collectOptionValues } from "./preset-options.js";

function renderPolicyText(contexts: RoleInspectionContext[]): void {
  for (const ctx of contexts) {
    if (ctx.error) {
      console.log(`\n[${ctx.role}] ERROR: ${ctx.error.message}`);
      continue;
    }
    console.log(`\n=== ${ctx.role} (${ctx.adapter}) ===`);
    console.log(`  Preset: ${ctx.preset.value} (${ctx.preset.source})`);
    console.log(`  Model: ${ctx.model ?? "(default)"}`);
    if (ctx.clamps.length > 0) {
      console.log("  Clamps:");
      for (const c of ctx.clamps) {
        console.log(`    ${c.field}: ${c.before} → ${c.after} (${c.reason})`);
      }
    }
    if (ctx.observation.warnings.length > 0) {
      console.log("  Warnings:");
      for (const w of ctx.observation.warnings) {
        console.log(`    [${w.reason}] ${w.field}: ${w.message}`);
      }
    }
    const t = ctx.observation.translation;
    console.log(
      `  Translation: ${JSON.stringify(t.nativeSummary)}`,
    );
  }
}

export const inspectPolicyCommand = new Command("inspect-policy")
  .description("Inspect effective policy for each role before execution")
  .requiredOption("--config <path>", "Path to crossfire config file")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--role <role>", "Filter to a single role")
  .option("--preset <preset>", "Global preset override")
  .option("--proposer-preset <preset>", "Proposer preset override")
  .option("--challenger-preset <preset>", "Challenger preset override")
  .option("--judge-preset <preset>", "Judge preset override")
  .option(
    "--turn-preset <turnId=preset>",
    "REJECTED: inspect commands do not accept turn-level overrides",
    collectOptionValues,
    [],
  )
  .action((options) => {
    if (options.turnPreset?.length > 0) {
      console.error(
        "Error: --turn-preset is not supported by inspect-policy. " +
          "Inspection shows baseline role-level policy, not per-turn views.",
      );
      process.exit(1);
    }

    const config = loadConfig(options.config);
    const contexts = buildInspectionContext(config, {
      cliGlobalPreset: options.preset,
      cliProposerPreset: options.proposerPreset,
      cliChallengerPreset: options.challengerPreset,
      cliJudgePreset: options.judgePreset,
    });

    const filtered = options.role
      ? contexts.filter((c) => c.role === options.role)
      : contexts;

    if (options.format === "json") {
      console.log(JSON.stringify({ roles: filtered }, null, 2));
    } else {
      renderPolicyText(filtered);
    }
  });
```

- [ ] **Step 5: Implement inspect-tools command**

```ts
// packages/cli/src/commands/inspect-tools.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { buildInspectionContext, type RoleInspectionContext } from "./inspection-context.js";
import { collectOptionValues } from "./preset-options.js";

function renderToolsText(contexts: RoleInspectionContext[]): void {
  for (const ctx of contexts) {
    if (ctx.error) {
      console.log(`\n[${ctx.role}] ERROR: ${ctx.error.message}`);
      continue;
    }
    console.log(`\n=== ${ctx.role} (${ctx.adapter}) ===`);
    console.log(`  Preset: ${ctx.preset.value} (${ctx.preset.source})`);
    console.log(`  Completeness: ${ctx.observation.completeness}`);
    if (ctx.observation.capabilityEffects.length > 0) {
      console.log("  Capability Effects:");
      for (const e of ctx.observation.capabilityEffects) {
        console.log(`    [${e.status}] ${e.field}: ${e.details ?? ""}`);
      }
    }
    if (ctx.observation.toolView.length > 0) {
      console.log("  Tools:");
      for (const t of ctx.observation.toolView) {
        const suffix = t.capabilityField ? ` (${t.capabilityField})` : "";
        console.log(
          `    ${t.status === "allowed" ? "✓" : "✗"} ${t.name} [${t.source}] ${t.status} — ${t.reason}${suffix}`,
        );
      }
    }
    if (ctx.observation.warnings.length > 0) {
      console.log("  Warnings:");
      for (const w of ctx.observation.warnings) {
        console.log(`    [${w.reason}] ${w.field}: ${w.message}`);
      }
    }
  }
}

export const inspectToolsCommand = new Command("inspect-tools")
  .description("Inspect effective tool view for each role before execution")
  .requiredOption("--config <path>", "Path to crossfire config file")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--role <role>", "Filter to a single role")
  .option("--preset <preset>", "Global preset override")
  .option("--proposer-preset <preset>", "Proposer preset override")
  .option("--challenger-preset <preset>", "Challenger preset override")
  .option("--judge-preset <preset>", "Judge preset override")
  .option(
    "--turn-preset <turnId=preset>",
    "REJECTED: inspect commands do not accept turn-level overrides",
    collectOptionValues,
    [],
  )
  .action((options) => {
    if (options.turnPreset?.length > 0) {
      console.error(
        "Error: --turn-preset is not supported by inspect-tools. " +
          "Inspection shows baseline role-level policy, not per-turn views.",
      );
      process.exit(1);
    }

    const config = loadConfig(options.config);
    const contexts = buildInspectionContext(config, {
      cliGlobalPreset: options.preset,
      cliProposerPreset: options.proposerPreset,
      cliChallengerPreset: options.challengerPreset,
      cliJudgePreset: options.judgePreset,
    });

    const filtered = options.role
      ? contexts.filter((c) => c.role === options.role)
      : contexts;

    if (options.format === "json") {
      const report = {
        roles: filtered.map((ctx) => ({
          role: ctx.role,
          adapter: ctx.adapter,
          preset: ctx.preset,
          tools: ctx.observation?.toolView ?? [],
          capabilityEffects: ctx.observation?.capabilityEffects ?? [],
          completeness: ctx.observation?.completeness ?? "minimal",
          warnings: ctx.observation?.warnings ?? [],
          ...(ctx.error ? { error: ctx.error } : {}),
        })),
      };
      console.log(JSON.stringify(report, null, 2));
    } else {
      renderToolsText(filtered);
    }
  });
```

- [ ] **Step 6: Register new commands**

Update `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { inspectPolicyCommand } from "./commands/inspect-policy.js";
import { inspectToolsCommand } from "./commands/inspect-tools.js";
import { replayCommand } from "./commands/replay.js";
import { resumeCommand } from "./commands/resume.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

const program = new Command()
  .name("crossfire")
  .description("AI agent debate orchestrator")
  .version("0.1.0");

program.addCommand(startCommand);
program.addCommand(resumeCommand);
program.addCommand(replayCommand);
program.addCommand(statusCommand);
program.addCommand(inspectPolicyCommand);
program.addCommand(inspectToolsCommand);

program.parse();
```

- [ ] **Step 7: Run tests**

Run: `cd packages/cli && npx vitest run __tests__/commands/inspect-policy.test.ts`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/inspection-context.ts
git add packages/cli/src/commands/inspect-policy.ts
git add packages/cli/src/commands/inspect-tools.ts
git add packages/cli/src/index.ts
git add packages/cli/__tests__/commands/inspect-policy.test.ts
git commit -m "feat(cli): add inspect-policy and inspect-tools commands"
```

---

## Task 9: CLI Surface Switch — Start Command Migration

**Files:**
- Modify: `packages/cli/src/commands/start.ts`
- Modify: `packages/cli/src/wiring/create-adapters.ts`
- Delete: `packages/cli/src/commands/execution-mode-options.ts`

This task rewires the `start` command to use the new config/preset system. It removes the old mode-first flags and profile-based adapter creation.

- [ ] **Step 1: Update start command to use preset flags**

Replace mode option registration in `packages/cli/src/commands/start.ts` (lines 88-105) with preset options. Replace the `buildExecutionModeConfig` call (line 231) with `buildPresetConfig`. Replace `createAdapters(roles, factories, executionModes)` (line 389) with the new config-based adapter creation.

Key changes:
- Replace `--mode` with `--preset`
- Replace `--proposer-mode` with `--proposer-preset`
- Replace `--challenger-mode` with `--challenger-preset`
- Add `--judge-preset`
- Replace `--turn-mode` with `--turn-preset`
- Add `--config` option for new config file
- Import `buildPresetConfig` from `preset-options.ts` instead of `buildExecutionModeConfig`

- [ ] **Step 2: Update create-adapters to accept ResolvedRoleRuntimeConfig**

Refactor `packages/cli/src/wiring/create-adapters.ts` to accept `ResolvedAllRoles` from the new resolver instead of the old `ResolvedRoles` + `DebateExecutionConfig`. The `startRole` function should use `resolved.preset.value` directly instead of deriving preset from execution mode config.

- [ ] **Step 3: Delete execution-mode-options.ts**

```bash
git rm packages/cli/src/commands/execution-mode-options.ts
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS (some existing tests that reference old mode flags may need updating)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/start.ts
git add packages/cli/src/wiring/create-adapters.ts
git rm packages/cli/src/commands/execution-mode-options.ts
git commit -m "feat(cli): switch start command to preset-first surface"
```

---

## Task 10: Policy Events and Runtime State Recording

**Files:**
- Modify: `packages/orchestrator-core/src/orchestrator-events.ts`
- Modify: `packages/orchestrator/src/runner.ts`

- [ ] **Step 1: Add policy event types to orchestrator-events.ts**

```ts
// Add to packages/orchestrator-core/src/orchestrator-events.ts
import type {
  PolicyClampNote,
  PolicyPreset,
  PolicyTranslationSummary,
  PolicyTranslationWarning,
  ResolvedPolicy,
} from "@crossfire/adapter-core";
import type { PresetSource } from "@crossfire/cli/config";

export interface PolicyBaselineEvent {
  kind: "policy.baseline";
  role: "proposer" | "challenger" | "judge";
  policy: ResolvedPolicy;
  clamps: PolicyClampNote[];
  preset: {
    value: PolicyPreset;
    source: PresetSource;
  };
  translationSummary: PolicyTranslationSummary;
  warnings: PolicyTranslationWarning[];
  timestamp: number;
}

export interface PolicyTurnOverrideEvent {
  kind: "policy.turn.override";
  role: "proposer" | "challenger";
  turnId: string;
  policy: ResolvedPolicy;
  preset: PolicyPreset;
  translationSummary: PolicyTranslationSummary;
  warnings: PolicyTranslationWarning[];
  timestamp: number;
}

export interface PolicyTurnOverrideClearEvent {
  kind: "policy.turn.override.clear";
  turnId: string;
  timestamp: number;
}
```

Add `RuntimePolicyState` type (spec-defined shape for Phase D reconstruction):

```ts
export interface RuntimePolicyState {
  baseline: {
    policy: ResolvedPolicy;
    clamps: PolicyClampNote[];
    preset: {
      value: PolicyPreset;
      source: PresetSource;
    };
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
  };
  currentTurnOverride?: {
    turnId: string;
    policy: ResolvedPolicy;
    preset: PolicyPreset;
    translationSummary: PolicyTranslationSummary;
    warnings: PolicyTranslationWarning[];
  };
}
```

Update the `OrchestratorEvent` union to include new policy events and rename `TurnModeChangedEvent` to `TurnPresetChangedEvent`:

```ts
export type OrchestratorEvent =
  | DebateStartedEvent
  | RoundStartedEvent
  | TurnPresetChangedEvent  // renamed from TurnModeChangedEvent
  | RoundCompletedEvent
  | JudgeStartedEvent
  | JudgeCompletedEvent
  | DebateCompletedEvent
  | DebateResumedEvent
  | DebatePausedEvent
  | DebateUnpausedEvent
  | DebateExtendedEvent
  | TurnInterruptRequestedEvent
  | UserInjectEvent
  | ClarificationRequestedEvent
  | ClarificationProvidedEvent
  | DirectorActionEvent
  | SynthesisStartedEvent
  | SynthesisCompletedEvent
  | SynthesisErrorEvent
  | PolicyBaselineEvent
  | PolicyTurnOverrideEvent
  | PolicyTurnOverrideClearEvent;
```

- [ ] **Step 2: Update runner.ts to emit policy events**

In `packages/orchestrator/src/runner.ts`, after each `adapter.startSession()`, emit a `policy.baseline` event. Replace the `turn.mode.changed` event push (lines 518-527) with a `policy.turn.override` event carrying the full ResolvedPolicy. After `waitForTurnCompleted`, emit `policy.turn.override.clear` if a turn override was active.

- [ ] **Step 3: Write event-derived state reconstruction tests**

```ts
// packages/orchestrator-core/__tests__/policy-events.test.ts
import { describe, expect, it } from "vitest";
import type {
  PolicyBaselineEvent,
  PolicyTurnOverrideEvent,
  PolicyTurnOverrideClearEvent,
  RuntimePolicyState,
} from "../src/orchestrator-events.js";
import { makeResolvedPolicy } from "@crossfire/adapter-core/testing";

function reconstructState(
  events: Array<PolicyBaselineEvent | PolicyTurnOverrideEvent | PolicyTurnOverrideClearEvent>,
): RuntimePolicyState | undefined {
  let state: RuntimePolicyState | undefined;
  for (const e of events) {
    if (e.kind === "policy.baseline") {
      state = {
        baseline: {
          policy: e.policy,
          clamps: e.clamps,
          preset: e.preset,
          translationSummary: e.translationSummary,
          warnings: e.warnings,
        },
      };
    } else if (e.kind === "policy.turn.override" && state) {
      state = {
        ...state,
        currentTurnOverride: {
          turnId: e.turnId,
          policy: e.policy,
          preset: e.preset,
          translationSummary: e.translationSummary,
          warnings: e.warnings,
        },
      };
    } else if (e.kind === "policy.turn.override.clear" && state) {
      state = { ...state, currentTurnOverride: undefined };
    }
  }
  return state;
}

describe("event-derived RuntimePolicyState", () => {
  const baselinePolicy = makeResolvedPolicy({ preset: "guarded", role: "proposer" });
  const overridePolicy = makeResolvedPolicy({ preset: "dangerous", role: "proposer" });

  it("reconstructs baseline from single event", () => {
    const events: PolicyBaselineEvent[] = [
      {
        kind: "policy.baseline",
        role: "proposer",
        policy: baselinePolicy,
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
        timestamp: Date.now(),
      },
    ];
    const state = reconstructState(events)!;
    expect(state.baseline.policy).toEqual(baselinePolicy);
    expect(state.currentTurnOverride).toBeUndefined();
  });

  it("turn override does not overwrite baseline", () => {
    const events = [
      {
        kind: "policy.baseline" as const,
        role: "proposer" as const,
        policy: baselinePolicy,
        clamps: [],
        preset: { value: "guarded" as const, source: "config" as const },
        translationSummary: {
          adapter: "claude",
          nativeSummary: {},
          exactFields: [],
          approximateFields: [],
          unsupportedFields: [],
        },
        warnings: [],
        timestamp: Date.now(),
      },
      {
        kind: "policy.turn.override" as const,
        role: "proposer" as const,
        turnId: "turn-1",
        policy: overridePolicy,
        preset: "dangerous" as const,
        translationSummary: {
          adapter: "claude",
          nativeSummary: {},
          exactFields: [],
          approximateFields: [],
          unsupportedFields: [],
        },
        warnings: [],
        timestamp: Date.now(),
      },
    ];
    const state = reconstructState(events)!;
    expect(state.baseline.policy).toEqual(baselinePolicy);
    expect(state.currentTurnOverride?.policy).toEqual(overridePolicy);
    expect(state.currentTurnOverride?.turnId).toBe("turn-1");
  });

  it("turn override clear removes current override", () => {
    const events = [
      {
        kind: "policy.baseline" as const,
        role: "proposer" as const,
        policy: baselinePolicy,
        clamps: [],
        preset: { value: "guarded" as const, source: "config" as const },
        translationSummary: {
          adapter: "claude",
          nativeSummary: {},
          exactFields: [],
          approximateFields: [],
          unsupportedFields: [],
        },
        warnings: [],
        timestamp: Date.now(),
      },
      {
        kind: "policy.turn.override" as const,
        role: "proposer" as const,
        turnId: "turn-1",
        policy: overridePolicy,
        preset: "dangerous" as const,
        translationSummary: {
          adapter: "claude",
          nativeSummary: {},
          exactFields: [],
          approximateFields: [],
          unsupportedFields: [],
        },
        warnings: [],
        timestamp: Date.now(),
      },
      {
        kind: "policy.turn.override.clear" as const,
        turnId: "turn-1",
        timestamp: Date.now(),
      },
    ];
    const state = reconstructState(events)!;
    expect(state.baseline.policy).toEqual(baselinePolicy);
    expect(state.currentTurnOverride).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator-core/src/orchestrator-events.ts
git add packages/orchestrator-core/__tests__/policy-events.test.ts
git add packages/orchestrator/src/runner.ts
git commit -m "feat(runtime): add event-derived policy state recording"
```

---

## Task 11: Legacy Type Removal

**Files:**
- Modify: `packages/adapter-core/src/types.ts`
- Modify: `packages/orchestrator-core/src/execution-modes.ts`
- Delete: `packages/cli/src/profile/schema.ts`
- Delete: `packages/cli/src/profile/loader.ts`
- Delete: `packages/cli/src/profile/resolver.ts`

- [ ] **Step 1: Remove deprecated types from adapter-core/types.ts**

Remove `RoleExecutionMode`, `TurnExecutionMode` types. Remove `executionMode` fields from `StartSessionInput` and `TurnInput`. Remove `allowedTools`, `disallowedTools` fields from `StartSessionInput`.

- [ ] **Step 2: Clean up orchestrator-core execution-modes.ts**

Remove `DebateExecutionConfig`, `ResolvedExecutionMode`, `resolveExecutionMode`, `resolveExecutionModeAsPolicy` — all replaced by the new preset-based resolution.

- [ ] **Step 3: Delete old profile module**

```bash
git rm packages/cli/src/profile/schema.ts
git rm packages/cli/src/profile/loader.ts
git rm packages/cli/src/profile/resolver.ts
```

Keep `packages/cli/src/profile/prompt-template.ts` and `packages/cli/src/profile/topic-template-classifier.ts` — they handle prompt template concerns independent of policy.

- [ ] **Step 4: Fix all compilation errors**

Update all files that import removed types/functions. Key files:
- `packages/orchestrator/src/runner.ts` — remove `resolveExecutionMode` import, use preset-based logic
- `packages/cli/src/wiring/create-adapters.ts` — remove old type imports
- All adapter files — remove `executionMode` handling from `startSession` / `sendTurn`

- [ ] **Step 5: Run full test suite**

Run: `pnpm build && pnpm test`
Expected: Build succeeds, all tests PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy execution mode types and old profile schema"
```

---

## Task 12: Documentation Updates

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: relevant `docs/architecture/*` files

- [ ] **Step 1: Update READMEs**

Replace all `--mode` / `--proposer-mode` / `--challenger-mode` / `--turn-mode` references with `--preset` / `--proposer-preset` / `--challenger-preset` / `--judge-preset` / `--turn-preset`.

Add `inspect-policy` and `inspect-tools` to the command reference section.

Update the configuration section to describe the new config file format with role profiles and provider bindings.

- [ ] **Step 2: Update architecture docs**

Update any docs/architecture files that reference execution modes to use preset/policy terminology.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md docs/
git commit -m "docs: update CLI reference for preset-first surface and inspection commands"
```

---

## Task 13: Final Integration Test

- [ ] **Step 1: Run full build and test**

```bash
pnpm build && pnpm test && pnpm lint
```

Expected: Clean build, all tests pass, no lint errors.

- [ ] **Step 2: Manual smoke test**

Create a test config file and run:

```bash
echo '{"providerBindings":[{"name":"test","adapter":"claude","model":"claude-sonnet"}],"roles":{"proposer":{"binding":"test"},"challenger":{"binding":"test"}}}' > /tmp/test-config.json
npx crossfire inspect-policy --config /tmp/test-config.json --format json
npx crossfire inspect-tools --config /tmp/test-config.json --format json
```

Verify JSON output contains expected structure with preset sources, clamp notes, and tool views.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: final integration fixes for Phase C"
```
