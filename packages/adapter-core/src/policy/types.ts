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
