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

/**
 * Preset source provenance — lives here in adapter-core so that both
 * cli and orchestrator-core can import it without dependency inversion.
 */
export type PresetSource =
	| "cli-role"
	| "cli-global"
	| "config"
	| "role-default";

/**
 * Evidence source provenance — independent from PresetSource.
 */
export type EvidenceSource =
	| "cli"
	| "config"
	| `template:${string}`
	| "role-default";
