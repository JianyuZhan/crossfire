// packages/adapter-core/src/policy/presets.ts
import type {
	CapabilityPolicy,
	InteractionPolicy,
	PolicyPreset,
} from "./types.js";

export interface PresetExpansion {
	readonly capabilities: Omit<CapabilityPolicy, "legacyToolOverrides">;
	readonly interaction: InteractionPolicy;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
	for (const value of Object.values(obj)) {
		if (value && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return Object.freeze(obj);
}

export const PRESET_EXPANSIONS: Readonly<
	Record<PolicyPreset, PresetExpansion>
> = deepFreeze({
	research: {
		capabilities: {
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		},
		interaction: {
			approval: "on-risk",
			limits: { maxTurns: 12 },
		},
	},
	guarded: {
		capabilities: {
			filesystem: "write",
			network: "search",
			shell: "readonly",
			subagents: "off",
		},
		interaction: {
			approval: "on-risk",
		},
	},
	dangerous: {
		capabilities: {
			filesystem: "write",
			network: "full",
			shell: "exec",
			subagents: "on",
		},
		interaction: {
			approval: "never",
		},
	},
	plan: {
		capabilities: {
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		},
		interaction: {
			approval: "always",
		},
	},
});
