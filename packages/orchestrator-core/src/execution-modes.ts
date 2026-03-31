import type {
	RoleExecutionMode,
	TurnExecutionMode,
} from "@crossfire/adapter-core";

export type DebateExecutionRole = "proposer" | "challenger";

export interface DebateExecutionConfig {
	defaultMode?: RoleExecutionMode;
	roleModes?: Partial<Record<DebateExecutionRole, RoleExecutionMode>>;
	turnOverrides?: Record<string, TurnExecutionMode>;
}

export interface ResolvedExecutionMode {
	baselineMode: RoleExecutionMode;
	effectiveMode: TurnExecutionMode;
	source: "debate-default" | "role-baseline" | "turn-override";
}

export function resolveExecutionMode(
	config: DebateExecutionConfig | undefined,
	role: DebateExecutionRole,
	turnId: string,
): ResolvedExecutionMode {
	const debateDefault = config?.defaultMode ?? "guarded";
	const baselineMode = config?.roleModes?.[role] ?? debateDefault;
	const overrideMode = config?.turnOverrides?.[turnId];

	if (overrideMode) {
		return {
			baselineMode,
			effectiveMode: overrideMode,
			source: "turn-override",
		};
	}

	return {
		baselineMode,
		effectiveMode: baselineMode,
		source:
			config?.roleModes?.[role] !== undefined
				? "role-baseline"
				: "debate-default",
	};
}
