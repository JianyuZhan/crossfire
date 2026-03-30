import { Box, Text } from "ink";
import type React from "react";
import stringWidth from "string-width";
import type { CommandState } from "../state/types.js";

interface CommandStatusLineProps {
	state: CommandState;
	width?: number;
}

const MAX_VISIBLE_APPROVALS = 3;

function findSharedSessionShortcut(state: CommandState): string | undefined {
	if (state.pendingApprovals.length === 0) return undefined;

	let sharedOptionIndex: number | undefined;
	for (const approval of state.pendingApprovals) {
		const optionIndex =
			approval.options?.findIndex(
				(option) =>
					option.id === "allow-session" ||
					(option.kind === "allow-always" && option.scope === "session"),
			) ?? -1;
		if (optionIndex < 0) return undefined;
		if (sharedOptionIndex === undefined) {
			sharedOptionIndex = optionIndex;
			continue;
		}
		if (sharedOptionIndex !== optionIndex) return undefined;
	}

	return sharedOptionIndex !== undefined
		? `/approve all ${sharedOptionIndex + 1}`
		: undefined;
}

function wrapPlainText(text: string, width: number): string[] {
	if (!text) return [""];
	const maxWidth = Math.max(12, width);
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (stringWidth(candidate) <= maxWidth) {
			current = candidate;
			continue;
		}
		if (current) lines.push(current);
		if (stringWidth(word) <= maxWidth) {
			current = word;
			continue;
		}
		let chunk = "";
		for (const ch of word) {
			const next = chunk + ch;
			if (stringWidth(next) > maxWidth && chunk) {
				lines.push(chunk);
				chunk = ch;
			} else {
				chunk = next;
			}
		}
		current = chunk;
	}

	if (current) lines.push(current);
	return lines.length > 0 ? lines : [""];
}

function commandForOption(
	approvalIndex: number,
	optionIndex: number,
	optionKind: "allow" | "deny" | "allow-always" | "other",
	useShortcut: boolean,
): string {
	const base = optionKind === "deny" ? "/deny" : "/approve";
	if (useShortcut) {
		return `${base} ${approvalIndex}`;
	}
	return `${base} ${approvalIndex} ${optionIndex + 1}`;
}

function buildApprovalLines(state: CommandState, width: number): string[] {
	const contentWidth = Math.max(24, width - 2);
	const lines = [
		`APPROVAL REQUIRED (${state.pendingApprovals.length} pending)`,
		"Quick actions: /approve all    /deny all",
	];
	const sessionShortcut = findSharedSessionShortcut(state);
	if (sessionShortcut) {
		lines.push(`Session shortcut: ${sessionShortcut}`);
	}
	const visible = state.pendingApprovals.slice(0, MAX_VISIBLE_APPROVALS);

	for (let i = 0; i < visible.length; i++) {
		const approval = visible[i];
		lines.push(
			`${i + 1}. ${approval.adapterId} ${approval.approvalType.toUpperCase()} ${approval.suggestion === "allow" ? "[suggest allow]" : approval.suggestion === "deny" ? "[suggest deny]" : ""}`.trim(),
		);
		for (const line of wrapPlainText(
			approval.detail ?? approval.title,
			contentWidth - 2,
		)) {
			lines.push(`  ${line}`);
		}
		if (approval.options && approval.options.length > 0) {
			const defaultAllowIndex =
				approval.options.findIndex(
					(option) =>
						option.isDefault &&
						(option.kind === "allow" || option.kind === "allow-always"),
				) ?? -1;
			const fallbackAllowIndex =
				defaultAllowIndex >= 0
					? defaultAllowIndex
					: approval.options.findIndex(
							(option) =>
								option.kind === "allow" || option.kind === "allow-always",
						);
			const defaultDenyIndex =
				approval.options.findIndex(
					(option) => option.isDefault && option.kind === "deny",
				) ?? -1;
			const fallbackDenyIndex =
				defaultDenyIndex >= 0
					? defaultDenyIndex
					: approval.options.findIndex((option) => option.kind === "deny");
			for (
				let optionIndex = 0;
				optionIndex < approval.options.length;
				optionIndex++
			) {
				const option = approval.options[optionIndex];
				const isDefaultAllow =
					(option.kind === "allow" || option.kind === "allow-always") &&
					optionIndex === fallbackAllowIndex;
				const isDefaultDeny =
					option.kind === "deny" && optionIndex === fallbackDenyIndex;
				const command = commandForOption(
					i + 1,
					optionIndex,
					option.kind,
					isDefaultAllow || isDefaultDeny,
				);
				lines.push(`  ${optionIndex + 1}. ${option.label}: ${command}`);
			}
		} else {
			lines.push(`  Approve: /approve ${i + 1}    Reject: /deny ${i + 1}`);
		}
	}

	const hidden = state.pendingApprovals.length - visible.length;
	if (hidden > 0) lines.push(`...and ${hidden} more pending approvals`);

	return lines;
}

function buildStatusLines(state: CommandState, width: number): string[] {
	// Hide in normal mode with nothing special to show
	if (
		state.mode === "normal" &&
		state.pendingApprovals.length === 0 &&
		!state.livePaused &&
		state.replaySpeed === undefined &&
		!state.replayPaused
	) {
		return [];
	}

	if (state.pendingApprovals.length > 0) {
		return buildApprovalLines(state, width);
	}

	const parts: string[] = [];
	if (state.mode === "approval") parts.push("APPROVAL MODE");
	if (state.mode === "replay") parts.push("REPLAY MODE");
	if (state.livePaused) parts.push("PAUSED");
	if (state.replaySpeed !== undefined)
		parts.push(`Speed: ${state.replaySpeed}x`);
	if (state.replayPaused) parts.push("PAUSED");
	return [parts.join(" | ")];
}

export function commandStatusLineHeight(
	state: CommandState,
	width: number,
): number {
	return buildStatusLines(state, width).length;
}

export function CommandStatusLine({
	state,
	width,
}: CommandStatusLineProps): React.ReactElement | null {
	const lines = buildStatusLines(state, width ?? process.stdout.columns ?? 80);
	if (lines.length === 0) return null;

	return (
		<Box paddingX={1} flexDirection="column">
			{lines.map((line, index) => {
				const isApprovalHeader =
					state.pendingApprovals.length > 0 && index === 0;
				const isApprovalEntry =
					state.pendingApprovals.length > 0 &&
					index > 0 &&
					!/^\s/.test(line) &&
					!line.startsWith("...");
				const isActionLine =
					/^\s+Approve: /.test(line) ||
					/^\s+\d+\. .+: \/(approve|deny)/.test(line);
				return (
					<Text
						key={`${index}-${line}`}
						backgroundColor={isApprovalHeader ? "yellow" : undefined}
						color={
							isApprovalHeader
								? "black"
								: isActionLine
									? "green"
									: isApprovalEntry
										? "cyan"
										: undefined
						}
						bold={isApprovalHeader || isApprovalEntry}
						dimColor={!isApprovalHeader && !isApprovalEntry && !isActionLine}
					>
						{line}
					</Text>
				);
			})}
		</Box>
	);
}
