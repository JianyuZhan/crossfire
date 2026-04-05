// packages/adapter-core/src/policy/role-contracts.ts
import type { DebateRole } from "../types.js";
import type { RoleContract } from "./types.js";

function deepFreeze<T extends object>(obj: T): Readonly<T> {
	for (const value of Object.values(obj)) {
		if (value && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return Object.freeze(obj);
}

export const DEFAULT_ROLE_CONTRACTS: Readonly<
	Record<DebateRole, RoleContract>
> = deepFreeze({
	proposer: {
		semantics: {
			exploration: "allowed",
			factCheck: "allowed",
			mayIntroduceNewProposal: true,
		},
		ceilings: {},
		evidenceDefaults: { bar: "medium" },
	},
	challenger: {
		semantics: {
			exploration: "allowed",
			factCheck: "allowed",
			mayIntroduceNewProposal: false,
		},
		ceilings: {},
		evidenceDefaults: { bar: "high" },
	},
	judge: {
		semantics: {
			exploration: "forbidden",
			factCheck: "minimal",
			mayIntroduceNewProposal: false,
		},
		ceilings: {
			filesystem: "read",
			network: "search",
			shell: "off",
			subagents: "off",
		},
		evidenceDefaults: { bar: "high" },
	},
});
