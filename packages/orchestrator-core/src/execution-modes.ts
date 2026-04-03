import {
	type CompilePolicyInput,
	type ResolvedPolicy,
	type RoleExecutionMode,
	type TurnExecutionMode,
	compilePolicy,
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
