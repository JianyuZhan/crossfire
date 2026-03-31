import type {
	RoleExecutionMode,
	TurnExecutionMode,
} from "@crossfire/adapter-core";
import type { DebateExecutionConfig } from "@crossfire/orchestrator-core";

const ROLE_EXECUTION_MODES = new Set<RoleExecutionMode>([
	"research",
	"guarded",
	"dangerous",
]);

const TURN_EXECUTION_MODES = new Set<TurnExecutionMode>([
	"research",
	"guarded",
	"dangerous",
	"plan",
]);

function parseRoleExecutionMode(
	value: string,
	label: string,
): RoleExecutionMode {
	if (ROLE_EXECUTION_MODES.has(value as RoleExecutionMode)) {
		return value as RoleExecutionMode;
	}
	throw new Error(`${label} must be one of: research, guarded, dangerous`);
}

function parseTurnExecutionMode(
	value: string,
	label: string,
): TurnExecutionMode {
	if (TURN_EXECUTION_MODES.has(value as TurnExecutionMode)) {
		return value as TurnExecutionMode;
	}
	throw new Error(
		`${label} must be one of: research, guarded, dangerous, plan`,
	);
}

export function collectOptionValues(
	value: string,
	previous: string[] = [],
): string[] {
	return [...previous, value];
}

export function buildExecutionModeConfig(options: {
	mode?: string;
	proposerMode?: string;
	challengerMode?: string;
	turnMode?: string[];
}): DebateExecutionConfig | undefined {
	const defaultMode = options.mode
		? parseRoleExecutionMode(options.mode, "--mode")
		: undefined;
	const proposerMode = options.proposerMode
		? parseRoleExecutionMode(options.proposerMode, "--proposer-mode")
		: undefined;
	const challengerMode = options.challengerMode
		? parseRoleExecutionMode(options.challengerMode, "--challenger-mode")
		: undefined;
	const turnOverrides = Object.fromEntries(
		(options.turnMode ?? []).map((entry) => {
			const [turnId, mode] = entry.split("=", 2);
			if (!turnId || !mode) {
				throw new Error(
					`--turn-mode entries must look like <turnId>=<mode>, received: ${entry}`,
				);
			}
			return [turnId, parseTurnExecutionMode(mode, `--turn-mode ${entry}`)];
		}),
	);

	if (
		!defaultMode &&
		!proposerMode &&
		!challengerMode &&
		Object.keys(turnOverrides).length === 0
	) {
		return undefined;
	}

	return {
		...(defaultMode ? { defaultMode } : {}),
		...(proposerMode || challengerMode
			? {
					roleModes: {
						...(proposerMode ? { proposer: proposerMode } : {}),
						...(challengerMode ? { challenger: challengerMode } : {}),
					},
				}
			: {}),
		...(Object.keys(turnOverrides).length > 0 ? { turnOverrides } : {}),
	};
}
