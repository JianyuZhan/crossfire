import type { PolicyPreset, PresetSource } from "@crossfire/adapter-core";

export type { PresetSource };

export const DEFAULT_ROLE_PRESETS: Record<
	"proposer" | "challenger" | "judge",
	PolicyPreset
> = {
	proposer: "guarded",
	challenger: "guarded",
	judge: "plan",
} as const;

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
