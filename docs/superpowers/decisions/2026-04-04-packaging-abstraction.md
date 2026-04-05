# D3-006: Provider-Specific Packaging Surfaces

**Date:** 2026-04-04  
**Status:** Decided  
**Context:** D3 plan - policy productization and cleanup  

## Decision

Crossfire will **not** normalize provider-native packaging mechanisms (skills, plugins, extensions, function declarations) into a cross-provider abstraction. The `ToolSource` enum (`builtin | mcp | provider-packaged | unknown`) remains observation metadata only. Provider packaging surfaces stay provider-specific.

## Problem Statement

Crossfire integrates three providers with different packaging and tool surfaces:

- **Claude** (Anthropic): Named builtin tools (`Read`, `Edit`, `Bash`, etc.) that are always available, plus optional MCP servers that attach additional tools at session start. Tool identity is stable; observation can enumerate and block specific tools by name.
- **Codex** (OpenAI): Capability-driven sandbox model (filesystem, shell, network) with no stable discrete tool inventory. Tools are ephemeral; observation sees sandbox levels and approval requests, not a persistent tool catalog.
- **Gemini** (Google): Coarse function declaration visibility and approval-mode control only. Current CLI integration does not expose fine-grained tool-level inspection or per-tool blocking.

The question: should Crossfire normalize these surfaces into a unified packaging abstraction, or keep them provider-specific?

## Options Considered

### Option A: Keep Provider-Specific

Accept that each provider handles packaging differently. Adapters translate Crossfire policy into provider-native parameters (tool deny lists for Claude, sandbox levels for Codex, approval modes for Gemini). Source tags in `ToolInspectionRecord` remain observation metadata for display/debugging, not a normalized product surface.

**Pros:**
- Semantic honesty: doesn't pretend providers share a tool catalog model when they don't
- Execution relevance: adapters can use provider-native blocking without indirection
- Testability: each adapter's policy translation is self-contained

**Cons:**
- No unified "list all available tools" API
- Users cannot write portable tool-level allow/deny rules

### Option B: Normalize into Crossfire Abstraction

Define a Crossfire tool/package interface that adapters must implement. Provide cross-provider tool listing, blocking, and metadata APIs. Introduce a normalized packaging layer parallel to MCP and builtin surfaces.

**Pros:**
- Cross-provider tool introspection and control
- Unified UX for tool management

**Cons:**
- False abstraction: Codex has no stable tool inventory to expose
- Semantic dishonesty: pretending providers share a tool model when Claude and Codex are fundamentally different
- Lock-in to current provider tool semantics; breaks when providers change packaging
- Implementation complexity: requires adapter-level tool translation layers and ongoing maintenance

## Evaluation Criteria

### 1. Semantic Honesty

**Does the abstraction accurately reflect provider reality?**

- **Option A (Keep Provider-Specific):** Yes. Each adapter exposes what the provider actually supports. Claude's builtin tool deny lists are Claude-specific. Codex's sandbox levels are Codex-specific. No false equivalence.
- **Option B (Normalize):** No. Codex does not have a stable tool catalog. Gemini CLI does not expose tool-level blocking. A normalized abstraction would have to invent synthetic tool surfaces for Codex and Gemini, or mark them as permanently degraded.

### 2. User Value

**Does this solve a real user problem?**

- **Option A:** Users can control tool access through Crossfire policy (capability enums + approval modes). Policy compilation and translation warnings show where intent is approximated. The current model is sufficient for risk-gated execution.
- **Option B:** Would enable cross-provider tool scripts (e.g., "block network tools in all providers"). However, policy presets already cover common capability profiles (`research`, `guarded`, `dangerous`, `plan`). Tool micromanagement is intentionally avoided because it creates provider lock-in and is not necessary for risk control.

**Winner:** Option A. Policy-driven capability control is enough. No evidence that users need portable tool-level scripts.

### 3. Execution Relevance

**Does the abstraction map cleanly to runtime behavior?**

- **Option A:** Direct mapping. Claude's `translatePolicy()` produces tool deny lists. Codex's `translatePolicy()` produces sandbox levels. Each adapter uses provider-native control surfaces without indirection.
- **Option B:** Requires ongoing translation layers. When Claude adds a new builtin tool, or Codex changes sandbox semantics, or Gemini gains tool-level blocking, the normalized abstraction must be updated and tested across all three providers.

**Winner:** Option A. Provider-native translation is simpler and more maintainable.

### 4. Testability

**Can adapter behavior be verified without cross-provider mocking?**

- **Option A:** Yes. Each adapter's policy translation tests are self-contained. Contract tests enforce shared event semantics, but do not require tool catalog normalization.
- **Option B:** No. Normalized abstraction requires shared tool catalog tests and cross-provider tool mocking, increasing test surface and fragility.

**Winner:** Option A.

## Decision: Keep Provider-Specific

Crossfire will **not** introduce a normalized packaging abstraction. Provider-native packaging surfaces remain provider-specific.

**Rationale:**
- **Semantic honesty:** Codex and Gemini do not have stable tool catalogs comparable to Claude's builtin tools. Normalization would require synthetic tool surfaces that misrepresent provider reality.
- **User value:** Policy presets and capability enums already provide sufficient risk control. No evidence that users need cross-provider tool-level scripting.
- **Execution relevance:** Provider-native translation is simpler and more maintainable than ongoing abstraction layers.
- **Testability:** Self-contained adapter translation tests are easier to verify than cross-provider tool catalog mocks.

## Consequences

### What Remains

**`ToolSource` enum (`builtin | mcp | provider-packaged | unknown`):**
- Lives in `adapter-core/src/policy/observation-types.ts`
- Used in `ToolInspectionRecord` for observation metadata
- Claude populates `source: "builtin"` for named tools like `Read`, `Bash`, `WebFetch`
- Codex and Gemini currently return empty `toolView[]` because they do not have stable tool inventories
- This is observation metadata for display/debugging, **not** a normalized product object

**Adapter-specific policy translation:**
- Claude: `translatePolicy()` → tool deny lists (`disallowedTools: ["Bash", "Write", ...]`)
- Codex: `translatePolicy()` → sandbox levels (`readOnly | workspace-write | danger-full-access`)
- Gemini: `translatePolicy()` → approval modes (`default | auto_edit | plan | yolo`)

**MCP attachments:**
- MCP servers remain provider-specific configuration
- `StartSessionInput.mcpServers` is passed to adapters, not normalized by Crossfire
- Each provider handles MCP attachment according to its own protocol (Claude supports MCP natively, Codex/Gemini do not)

### Explicit Prohibition on Stealth Normalization

**Do not** introduce normalized packaging through:
- Helper types that unify Claude/Codex/Gemini tool surfaces
- Cross-provider tool catalog builders
- Synthetic tool inventory for Codex or Gemini
- Policy compiler logic that branches on tool names rather than capability enums

If cross-provider tool normalization becomes necessary in the future, it requires:
1. A new spec with evidence of user demand
2. Provider-capability analysis showing stable tool catalog semantics across Claude, Codex, and Gemini
3. A new implementation plan

## Current Adapter Surfaces (Evidence)

### Claude (`adapter-claude`)

**Tools:**
- Builtin tools: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `Task` (subagents)
- Tool lifecycle visible through SDK hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
- Policy translation produces tool deny lists based on capability enums
- `ToolInspectionRecord` populated with `source: "builtin"` for all known tools

**Packaging:**
- MCP servers attach at session start via SDK
- Source tags could distinguish builtin vs MCP tools, but current observation does not yet track MCP tool provenance per-tool
- Tool identity is stable; observation can enumerate and block tools by name

### Codex (`adapter-codex`)

**Tools:**
- No stable discrete tool inventory
- Tool lifecycle visible through JSON-RPC notifications: `turn/commandApprovalRequired`, `turn/fileChangeApprovalRequired`, `turn/userInputRequired`
- Approval requests show tool intent, but tool names are ephemeral and approval-specific
- Policy translation produces sandbox levels (`readOnly`, `workspace-write`, `danger-full-access`) and `networkDisabled` flag

**Packaging:**
- Capability-driven sandbox model (filesystem/shell/network access levels)
- `ToolInspectionRecord` empty (`toolView: []`) because Codex does not expose a tool catalog
- Tool control is coarse-grained via sandbox policy, not per-tool blocking

### Gemini (`adapter-gemini`)

**Tools:**
- Function declaration visibility and approval-mode control only
- Current CLI integration does not expose tool-level inspection or per-tool blocking
- Policy translation produces approval modes (`default`, `auto_edit`, `plan`, `yolo`)

**Packaging:**
- Coarse approval-mode control via CLI arguments
- `ToolInspectionRecord` empty (`toolView: []`) because Gemini CLI does not expose a tool catalog
- No runtime tool-level blocking surface

## Migration Note

No migration is required. This decision preserves the current architecture. Users continue to configure tool access through:
- **Capability enums** (`filesystem`, `network`, `shell`, `subagents`)
- **Policy presets** (`research`, `guarded`, `dangerous`, `plan`)
- **Templates** for reusable policy bundles
- **MCP servers** via provider-specific configuration

## Verification

After decision record:
- `rg -n "provider-packaged|packaging abstraction|normalized packaging" docs/architecture docs/superpowers/decisions` shows only this decision doc and aligned architecture references
- No normalized packaging abstraction exists in `adapter-core/src/policy/`
- No helper types unify Claude/Codex/Gemini tool surfaces
- `ToolSource` remains observation metadata, not a product object

## References

- D3 Plan: `docs/superpowers/plans/2026-04-04-d3-cleanup-packaging-decision.md`
- Policy Surface: `docs/architecture/policy-surface.md`
- Adapter Layer: `docs/architecture/adapter-layer.md`
- Observation Types: `packages/adapter-core/src/policy/observation-types.ts`
