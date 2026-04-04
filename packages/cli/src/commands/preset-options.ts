// packages/cli/src/commands/preset-options.ts
import type { PolicyPreset } from "@crossfire/adapter-core";

const VALID_PRESETS = new Set<PolicyPreset>([
	"research",
	"guarded",
	"dangerous",
	"plan",
]);

export function parsePresetValue(value: string, label: string): PolicyPreset {
	if (VALID_PRESETS.has(value as PolicyPreset)) {
		return value as PolicyPreset;
	}
	throw new Error(
		`${label} must be one of: research, guarded, dangerous, plan`,
	);
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
}

export function buildPresetConfig(options: {
	preset?: string;
	proposerPreset?: string;
	challengerPreset?: string;
	judgePreset?: string;
	turnPreset?: string[];
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

	if (
		!globalPreset &&
		!proposerPreset &&
		!challengerPreset &&
		!judgePreset &&
		!turnPresets
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
	};
}

export function collectOptionValues(
	value: string,
	previous: string[] = [],
): string[] {
	return [...previous, value];
}
