// packages/cli/src/commands/preset-options.ts
import type { EvidenceBar, PolicyPreset } from "@crossfire/adapter-core";
import type { CliPresetOverrides } from "../config/resolver.js";

const VALID_PRESETS = new Set<PolicyPreset>([
	"research",
	"guarded",
	"dangerous",
	"plan",
]);

const VALID_EVIDENCE_BARS = new Set<EvidenceBar>(["low", "medium", "high"]);

export function parsePresetValue(value: string, label: string): PolicyPreset {
	if (VALID_PRESETS.has(value as PolicyPreset)) {
		return value as PolicyPreset;
	}
	throw new Error(
		`${label} must be one of: research, guarded, dangerous, plan`,
	);
}

export function parseEvidenceBarValue(
	value: string,
	label: string,
): EvidenceBar {
	if (VALID_EVIDENCE_BARS.has(value as EvidenceBar)) {
		return value as EvidenceBar;
	}
	throw new Error(`${label} must be one of: low, medium, high`);
}

export function parseTurnPresets(
	entries: string[],
): Record<string, PolicyPreset> {
	return Object.fromEntries(
		entries.map((entry) => {
			const [turnId, preset] = entry.split("=", 2);
			if (!turnId || !preset) {
				throw new Error(
					`--turn-preset entries must look like <turnId>=<preset>, received: ${entry}`,
				);
			}
			return [turnId, parsePresetValue(preset, `--turn-preset ${entry}`)];
		}),
	);
}

export interface PresetConfig {
	globalPreset?: PolicyPreset;
	rolePresets?: Partial<
		Record<"proposer" | "challenger" | "judge", PolicyPreset>
	>;
	turnPresets?: Record<string, PolicyPreset>;
	evidenceBar?: EvidenceBar;
}

export function toCliPresetOverrides(
	presetConfig?: PresetConfig,
): CliPresetOverrides {
	return {
		...(presetConfig?.globalPreset
			? { cliGlobalPreset: presetConfig.globalPreset }
			: {}),
		...(presetConfig?.rolePresets?.proposer
			? { cliProposerPreset: presetConfig.rolePresets.proposer }
			: {}),
		...(presetConfig?.rolePresets?.challenger
			? { cliChallengerPreset: presetConfig.rolePresets.challenger }
			: {}),
		...(presetConfig?.rolePresets?.judge
			? { cliJudgePreset: presetConfig.rolePresets.judge }
			: {}),
		...(presetConfig?.evidenceBar
			? { cliEvidenceBar: presetConfig.evidenceBar }
			: {}),
	};
}

export function buildPresetConfig(options: {
	preset?: string;
	proposerPreset?: string;
	challengerPreset?: string;
	judgePreset?: string;
	turnPreset?: string[];
	evidenceBar?: string;
}): PresetConfig | undefined {
	const globalPreset = options.preset
		? parsePresetValue(options.preset, "--preset")
		: undefined;
	const proposerPreset = options.proposerPreset
		? parsePresetValue(options.proposerPreset, "--proposer-preset")
		: undefined;
	const challengerPreset = options.challengerPreset
		? parsePresetValue(options.challengerPreset, "--challenger-preset")
		: undefined;
	const judgePreset = options.judgePreset
		? parsePresetValue(options.judgePreset, "--judge-preset")
		: undefined;
	const turnPresets = options.turnPreset?.length
		? parseTurnPresets(options.turnPreset)
		: undefined;
	const evidenceBar = options.evidenceBar
		? parseEvidenceBarValue(options.evidenceBar, "--evidence-bar")
		: undefined;

	if (
		!globalPreset &&
		!proposerPreset &&
		!challengerPreset &&
		!judgePreset &&
		!turnPresets &&
		!evidenceBar
	) {
		return undefined;
	}

	return {
		...(globalPreset ? { globalPreset } : {}),
		...(proposerPreset || challengerPreset || judgePreset
			? {
					rolePresets: {
						...(proposerPreset ? { proposer: proposerPreset } : {}),
						...(challengerPreset ? { challenger: challengerPreset } : {}),
						...(judgePreset ? { judge: judgePreset } : {}),
					},
				}
			: {}),
		...(turnPresets ? { turnPresets } : {}),
		...(evidenceBar ? { evidenceBar } : {}),
	};
}

export function buildInspectionCliOverrides(options: {
	preset?: string;
	proposerPreset?: string;
	challengerPreset?: string;
	judgePreset?: string;
	turnPreset?: string[];
	evidenceBar?: string;
}): CliPresetOverrides {
	const presetConfig = buildPresetConfig(options);
	if (presetConfig?.turnPresets) {
		throw new Error(
			"--turn-preset is not supported by inspection commands. Inspection shows baseline role-level policy, not per-turn views.",
		);
	}
	return toCliPresetOverrides(presetConfig);
}

export function collectOptionValues(
	value: string,
	previous: string[] = [],
): string[] {
	return [...previous, value];
}
