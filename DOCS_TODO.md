# Documentation Updates Needed

## Task 12: Remove prompt.stats events

The following documentation references need to be updated:

### docs/architecture.md
- Line 336: Remove `prompt.stats` row from OrchestratorEvent table
- Line 634: Remove `→ emit prompt.stats` from the proposer turn description

The `prompt.stats` events have been removed from the codebase and replaced by adapter-level local metrics in `usage.updated` events.
