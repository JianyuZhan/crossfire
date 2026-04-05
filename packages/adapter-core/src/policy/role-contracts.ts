// packages/adapter-core/src/policy/role-contracts.ts
import type { DebateRole } from "../types.js";
import { deepFreeze } from "./deep-freeze.js";
import type { RoleContract } from "./types.js";

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
