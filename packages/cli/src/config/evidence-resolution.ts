import type { EvidenceBar } from "@crossfire/adapter-core";

export type EvidenceSource =
	| "cli"
	| "config"
	| `template:${string}`
	| "role-default";

export interface ResolvedEvidence {
	bar: EvidenceBar | undefined;
	source: EvidenceSource;
}

export function resolveRoleEvidence(input: {
	role: "proposer" | "challenger" | "judge";
	cliEvidenceBar?: EvidenceBar;
	configEvidence?: { bar?: EvidenceBar };
	templateEvidence?: { bar?: EvidenceBar };
	templateName?: string;
}): ResolvedEvidence {
	if (input.cliEvidenceBar) {
		return { bar: input.cliEvidenceBar, source: "cli" };
	}
	if (input.configEvidence?.bar) {
		return { bar: input.configEvidence.bar, source: "config" };
	}
	if (input.templateEvidence?.bar && input.templateName) {
		return {
			bar: input.templateEvidence.bar,
			source: `template:${input.templateName}`,
		};
	}
	return { bar: undefined, source: "role-default" };
}
