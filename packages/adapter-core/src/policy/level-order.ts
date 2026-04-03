// packages/adapter-core/src/policy/level-order.ts
import type {
	FilesystemLevel,
	NetworkLevel,
	ShellLevel,
	SubagentLevel,
} from "./types.js";

const FILESYSTEM_ORDER: readonly FilesystemLevel[] = ["off", "read", "write"];
const NETWORK_ORDER: readonly NetworkLevel[] = [
	"off",
	"search",
	"fetch",
	"full",
];
const SHELL_ORDER: readonly ShellLevel[] = ["off", "readonly", "exec"];
const SUBAGENT_ORDER: readonly SubagentLevel[] = ["off", "on"];

function getLevelIndex<T extends string>(
	label: string,
	order: readonly T[],
	value: T,
): number {
	const idx = order.indexOf(value);
	if (idx === -1) {
		throw new Error(
			`Invalid ${label} level "${value}". Valid: ${order.join(", ")}`,
		);
	}
	return idx;
}

function clampLevel<T extends string>(
	label: string,
	order: readonly T[],
	base: T,
	ceiling: T | undefined,
): T {
	if (ceiling === undefined) return base;
	return order[
		Math.min(
			getLevelIndex(label, order, base),
			getLevelIndex(label, order, ceiling),
		)
	];
}

export function clampFilesystem(
	base: FilesystemLevel,
	ceiling: FilesystemLevel | undefined,
): FilesystemLevel {
	return clampLevel("filesystem", FILESYSTEM_ORDER, base, ceiling);
}

export function clampNetwork(
	base: NetworkLevel,
	ceiling: NetworkLevel | undefined,
): NetworkLevel {
	return clampLevel("network", NETWORK_ORDER, base, ceiling);
}

export function clampShell(
	base: ShellLevel,
	ceiling: ShellLevel | undefined,
): ShellLevel {
	return clampLevel("shell", SHELL_ORDER, base, ceiling);
}

export function clampSubagents(
	base: SubagentLevel,
	ceiling: SubagentLevel | undefined,
): SubagentLevel {
	return clampLevel("subagents", SUBAGENT_ORDER, base, ceiling);
}
