# D3-005: Remove Legacy Tool Override Compatibility Path

**Date:** 2026-04-04  
**Status:** Decided  
**Context:** D3 plan - policy productization and cleanup  

## Decision

Remove the `legacyToolOverrides` field from `CapabilityPolicy` and all associated compiler, translation, and observation logic. Under D3's no-compatibility assumption, legacy tool allow/deny lists (`allowed_tools`, `disallowed_tools`) should not survive as a hidden second authoring path parallel to the policy template/evidence/preset surface.

## What Was Removed

### Type Definitions (`adapter-core`)

- `CapabilityPolicy.legacyToolOverrides?: { allow?, deny?, source }` - removed from capability type
- `LegacyToolPolicyInput` - removed
- `CompilePolicyInput.legacyToolPolicy` - removed from compiler input
- Simplified `CapabilityCeilings` from `Partial<Readonly<Omit<CapabilityPolicy, "legacyToolOverrides">>>` to `Partial<Readonly<CapabilityPolicy>>`

### Compiler (`adapter-core`)

- `applyLegacyToolOverrides()` - deleted helper that attached legacy overrides to compiled capabilities
- Compiler no longer accepts or processes `legacyToolPolicy` input
- Preset expansions simplified - no longer use `Omit<CapabilityPolicy, "legacyToolOverrides">`

### Adapter Translation (Claude, Codex, Gemini)

**Claude:**
- `resolveToolPolicy()` - simplified to only process capability-driven deny lists
- Removed conflicting legacy allow warnings
- Removed `allowedTools` / merged allow/deny logic
- `resolveToolView()` - simplified to only show capability-policy or adapter-default reasons, no legacy_override reasons

**Codex:**
- Removed `not_implemented` warning for `capabilities.legacyToolOverrides`
- Translation no longer branches on presence of legacy overrides

**Gemini:**
- Removed `not_implemented` warning for `capabilities.legacyToolOverrides`
- Observation no longer checks for legacy overrides

### Runner (`orchestrator`)

- `AdapterMap.proposer/challenger/judge.legacyToolPolicyInput` - removed field
- Turn override recompilation no longer carries forward legacy tool input
- `executeAgentTurn()` internal `AgentTurnInput.adapterEntry.legacyToolPolicyInput` - removed

### CLI

- `create-adapters.ts` no longer sets `legacyToolPolicyInput: undefined` on adapter entries

## Why This Was a Compatibility Bridge

The `legacyToolOverrides` field was originally added to preserve old `allowed_tools`/`disallowed_tools` config through the policy pipeline during a migration period. It allowed tool restrictions to exist alongside capability enums. However:

1. **Dual authoring paths confuse intent:** Having both capability enums (`filesystem: "read"`) and tool lists (`deny: ["Write"]`) makes it unclear which takes precedence and why.
2. **Provider translation complexity:** Adapters had to merge capability-driven deny lists with legacy allow/deny logic, producing complex conflict resolution and approximate warnings.
3. **Turn override ambiguity:** The runner had to decide whether turn-level preset overrides should preserve or discard baseline legacy tool input.
4. **No migration value under D3:** D3 assumes no backward compatibility with pre-productization config. Templates, evidence policy, and presets are the only supported authoring surfaces.

## Why Templates/Evidence/Presets Remain the Only Supported Surface

The policy model is now:

```text
Template (base preset + overrides) → CompilePolicy(preset, role, evidence, interaction) → ResolvedPolicy → translatePolicy() → Provider-Native Options
```

Users configure:
- **Presets** (`research`, `guarded`, `dangerous`, `plan`) for capability baselines
- **Role contracts** for semantic constraints and ceilings
- **Templates** for bundled preset + evidence + interaction overrides
- **Evidence policy** for citation strength requirements

Tool-level allow/deny is intentionally not exposed because:
- Capability enums are coarse-grained by design (off/read/write for filesystem, off/search/fetch/full for network)
- Per-tool granularity creates provider lock-in (Claude's `Read`/`Edit` vs Codex's sandbox modes)
- Policy productization goal is provider-agnostic reasoning about risk, not tool micromanagement

## Migration Note

No compatibility path is retained. Configurations that previously used `allowed_tools` or `disallowed_tools` must migrate to:
- Capability enums for tool access control
- Presets for common capability profiles
- Templates for reusable policy bundles

## Verification

After removal:
- `pnpm build` passes across all packages
- Policy compiler tests verify capabilities no longer contain `legacyToolOverrides`
- Adapter translation tests verify no legacy warnings are emitted
- Adapter observation tests verify tool inspection never shows `legacy_override` reasons
- Runner tests verify turn overrides do not preserve legacy tool input
- `rg "legacyToolOverrides|allowed_tools|disallowed_tools"` in source confirms removal (config test fixtures may still reference old schema for validation)

## References

- D3 Plan: `docs/superpowers/plans/2026-04-04-d3-cleanup-packaging-decision.md`
- Policy Surface: `docs/architecture/policy-surface.md`
- Adapter Layer: `docs/architecture/adapter-layer.md`
