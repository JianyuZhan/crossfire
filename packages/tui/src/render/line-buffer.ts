import stringWidth from "string-width";
import {
	ROLE_COLORS,
	STATUS_ICONS,
	formatDuration,
	roleLabel,
} from "../constants.js";
import type {
	ContentChunk,
	RenderBlock,
	ScreenLine,
	StyledSegment,
} from "../state/types.js";

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

/**
 * Grapheme-safe truncation with ellipsis based on display width.
 */
export function truncate(
	text: string,
	maxWidth: number,
	ellipsis = "\u2026",
): string {
	const tw = stringWidth(text);
	if (tw <= maxWidth) return text;

	const ellipsisWidth = stringWidth(ellipsis);
	const targetWidth = maxWidth - ellipsisWidth;
	if (targetWidth <= 0) return ellipsis.slice(0, maxWidth);

	let result = "";
	let currentWidth = 0;

	for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
		const segWidth = stringWidth(segment);
		if (currentWidth + segWidth > targetWidth) break;
		result += segment;
		currentWidth += segWidth;
	}

	return result + ellipsis;
}

/**
 * Creates a ScreenLine from styled segments with computed display width.
 */
export function screenLine(segments: StyledSegment[]): ScreenLine {
	const displayWidth = segments.reduce((w, s) => w + stringWidth(s.text), 0);
	return { segments, displayWidth };
}

/**
 * Creates a line of spaces with exact display width.
 */
export function emptyLine(width: number): ScreenLine {
	return {
		segments: [{ text: " ".repeat(width), style: {} }],
		displayWidth: width,
	};
}

/**
 * Pads a line to target width with spaces.
 */
export function padRight(line: ScreenLine, targetWidth: number): ScreenLine {
	const gap = targetWidth - line.displayWidth;
	if (gap <= 0) return line;
	return {
		segments: [...line.segments, { text: " ".repeat(gap), style: {} }],
		displayWidth: targetWidth,
	};
}

interface WrapOptions {
	firstLinePrefix?: StyledSegment[];
	continuationIndent?: number;
	style: {
		bold?: boolean;
		dim?: boolean;
		color?: string;
		italic?: boolean;
	};
}

/**
 * Wraps text to fit within maxWidth, breaking at word boundaries when possible.
 * Handles CJK characters, newlines, and optional prefixes/indents.
 */
export function wrapText(
	text: string,
	maxWidth: number,
	opts: WrapOptions,
): ScreenLine[] {
	if (text === "") {
		return [
			screenLine(opts.firstLinePrefix ?? [{ text: "", style: opts.style }]),
		];
	}

	const naturalLines = text.split("\n");
	const result: ScreenLine[] = [];
	const indent = opts.continuationIndent ?? 0;

	for (let li = 0; li < naturalLines.length; li++) {
		const rawLine = naturalLines[li];
		const isFirstNatural = li === 0;

		const prefix =
			isFirstNatural && result.length === 0 ? opts.firstLinePrefix : undefined;
		const prefixWidth = prefix
			? prefix.reduce((w, s) => w + stringWidth(s.text), 0)
			: 0;

		const firstLineWidth = maxWidth - prefixWidth;
		const contWidth = maxWidth - indent;

		if (rawLine === "") {
			const segs: StyledSegment[] = prefix
				? [...prefix]
				: [{ text: "", style: opts.style }];
			result.push(screenLine(segs));
			continue;
		}

		const graphemes: { segment: string; width: number }[] = [];
		for (const { segment } of GRAPHEME_SEGMENTER.segment(rawLine)) {
			graphemes.push({ segment, width: stringWidth(segment) });
		}

		let gi = 0;
		let isFirstWrapped = true;

		while (gi < graphemes.length) {
			const availWidth = isFirstWrapped ? firstLineWidth : contWidth;
			let lineText = "";
			let lineWidth = 0;
			let lastSpaceIdx = -1;
			const startGi = gi;

			// Build line greedily, tracking spaces
			while (gi < graphemes.length) {
				const g = graphemes[gi];
				const nextWidth = lineWidth + g.width;

				// If this grapheme would exceed width and we have content, stop
				if (nextWidth > availWidth && lineText.length > 0) break;

				lineText += g.segment;
				lineWidth = nextWidth;

				// Track last space position (after adding it)
				if (g.segment === " ") {
					lastSpaceIdx = gi;
				}

				gi++;
			}

			// If we stopped mid-text (not at end)
			if (gi < graphemes.length) {
				// Check if we stopped AT a space or before one
				const stoppedAtSpace = graphemes[gi].segment === " ";

				if (stoppedAtSpace) {
					// We can fit everything up to this space, skip the space
					gi++;
					lineText = lineText.trimEnd();
				} else if (lastSpaceIdx >= startGi) {
					// We stopped mid-word; break at the last space we saw
					gi = lastSpaceIdx + 1;
					// Rebuild lineText up to (but not including) the space
					lineText = "";
					for (let i = startGi; i < lastSpaceIdx; i++) {
						lineText += graphemes[i].segment;
					}
				} else {
					// No space found; hard break
					lineText = lineText.trimEnd();
				}
			} else {
				// Reached end of text
				lineText = lineText.trimEnd();
			}

			const segs: StyledSegment[] = [];
			if (isFirstWrapped && prefix) {
				segs.push(...prefix);
			} else if (!isFirstWrapped && indent > 0) {
				segs.push({ text: " ".repeat(indent), style: {} });
			}
			segs.push({ text: lineText, style: opts.style });

			result.push(screenLine(segs));
			isFirstWrapped = false;
		}
	}

	return result;
}

export function buildPanelLines(
	blocks: RenderBlock[],
	panelWidth: number,
): ScreenLine[] {
	const result: ScreenLine[] = [];

	for (const block of blocks) {
		switch (block.kind) {
			case "agent-header": {
				const icon = STATUS_ICONS[block.status] ?? "\u25CB";
				const color = ROLE_COLORS[block.role] ?? "white";
				const label = roleLabel(block.role);
				const agent = block.agentType ? ` [${block.agentType}]` : "";
				result.push(
					screenLine([
						{ text: `${icon} ${label}${agent}`, style: { bold: true, color } },
					]),
				);
				const dur = block.duration
					? ` (${formatDuration(block.duration)})`
					: "";
				const statusColor = block.status === "error" ? "red" : "cyan";
				result.push(
					screenLine([
						{ text: `  ${block.status}${dur}`, style: { color: statusColor } },
					]),
				);
				break;
			}
			case "thinking": {
				const prefix =
					block.thinkingType === "reasoning-summary"
						? "Reasoning: "
						: "\uD83D\uDCAD ";
				const lines = wrapText(block.text, panelWidth, {
					firstLinePrefix: [{ text: prefix, style: { dim: true } }],
					continuationIndent: prefix.length,
					style: { dim: true, italic: true },
				});
				result.push(...lines);
				break;
			}
			case "plan": {
				result.push(
					screenLine([{ text: "Plan", style: { bold: true, dim: true } }]),
				);
				const STEP_PREFIXES: Record<string, string> = {
					completed: "[x] ",
					in_progress: "[>] ",
					pending: "[ ] ",
					failed: "[!] ",
				};
				for (const step of block.steps) {
					const prefix = STEP_PREFIXES[step.status] ?? "[ ] ";
					result.push(
						...wrapText(`${prefix}${step.title}`, panelWidth, {
							continuationIndent: prefix.length,
							style: { dim: true },
						}),
					);
				}
				break;
			}
			case "subagent": {
				const prefix =
					block.status === "completed" ? "Subagent ✓ " : "Subagent ▶ ";
				result.push(
					...wrapText(`${prefix}${block.description}`, panelWidth, {
						continuationIndent: prefix.length,
						style: { dim: true },
					}),
				);
				break;
			}
			case "tool-call": {
				const TOOL_PREFIXES: Record<string, string> = {
					running: ">>",
					success: "<<",
					error: "!!",
				};
				const prefix = TOOL_PREFIXES[block.status] ?? "!!";
				const summary = block.summary ? ` (${block.summary})` : "";
				const elapsed =
					block.status === "running" && block.elapsedMs
						? ` ${block.elapsedMs}ms`
						: "";
				const text = `${prefix} ${block.toolName}${summary}${elapsed}`;
				result.push(
					...wrapText(text, panelWidth, {
						continuationIndent: 3,
						style: { dim: true },
					}),
				);
				break;
			}
			case "message": {
				result.push(emptyLine(0));
				const lines = wrapText(block.text, panelWidth, { style: {} });
				result.push(...lines);
				break;
			}
			case "warning": {
				result.push(
					screenLine([
						{
							text: truncate(`\u26A0 ${block.text}`, panelWidth),
							style: { color: "yellow" },
						},
					]),
				);
				break;
			}
			case "error": {
				const lines = wrapText(block.text, panelWidth, {
					firstLinePrefix: [
						{ text: "Error: ", style: { color: "red", bold: true } },
					],
					continuationIndent: 7,
					style: { color: "red", bold: true },
				});
				const limited = lines.slice(0, 3);
				if (lines.length > 3) {
					const last = limited[2];
					const lastText = last.segments.map((s) => s.text).join("");
					limited[2] = screenLine([
						{
							text: truncate(lastText, panelWidth),
							style: { color: "red", bold: true },
						},
					]);
				}
				result.push(...limited);
				break;
			}
			case "separator": {
				result.push(emptyLine(0));
				break;
			}
		}
	}

	return result;
}

const BORDER_SEG: StyledSegment = { text: "\u2502", style: { dim: true } };

function mergeSideBySide(
	left: ScreenLine,
	right: ScreenLine,
	panelWidth: number,
): ScreenLine {
	const paddedLeft = padRight(left, panelWidth);
	const paddedRight = padRight(right, panelWidth);
	return {
		segments: [
			BORDER_SEG,
			...paddedLeft.segments,
			BORDER_SEG,
			...paddedRight.segments,
			BORDER_SEG,
		],
		displayWidth: panelWidth * 2 + 3,
	};
}

export function buildGlobalLineBuffer(
	chunks: ContentChunk[],
	contentWidth: number,
): ScreenLine[] {
	const result: ScreenLine[] = [];
	const panelWidth = Math.floor((contentWidth - 3) / 2);

	for (let ci = 0; ci < chunks.length; ci++) {
		if (ci > 0) {
			result.push(emptyLine(0));
		}

		const chunk = chunks[ci];

		switch (chunk.type) {
			case "round": {
				if (chunk.collapsed) {
					const summary = chunk.collapsedSummary;
					const hint = `/expand ${chunk.roundNumber} to expand`;
					// Line 1: round label + /expand hint
					result.push(
						screenLine([
							{
								text: `\u25B8 Round ${chunk.roundNumber}/${chunk.maxRounds}`,
								style: { bold: true },
							},
							{ text: `  ${hint}`, style: { color: "cyan", bold: true } },
						]),
					);
					if (summary) {
						// Line 2: P summary
						result.push(
							screenLine([
								{ text: "  P: ", style: { color: "cyan", bold: true } },
								{
									text: truncate(summary.proposerLine, contentWidth - 6),
									style: { dim: true },
								},
							]),
						);
						// Line 3: C summary
						result.push(
							screenLine([
								{ text: "  C: ", style: { color: "#ffb86c", bold: true } },
								{
									text: truncate(summary.challengerLine, contentWidth - 6),
									style: { dim: true },
								},
							]),
						);
					}
				} else {
					// Top border: ┌── Round N/M ──────────┐
					const label = ` Round ${chunk.roundNumber}/${chunk.maxRounds} `;
					const borderStyle = chunk.active
						? { bold: true, color: "cyan" }
						: { dim: true };
					const remainWidth = Math.max(0, contentWidth - 2 - label.length);
					const topBorder = `\u250C\u2500${label}${"\u2500".repeat(remainWidth)}\u2510`;
					result.push(screenLine([{ text: topBorder, style: borderStyle }]));
					for (let i = 0; i < chunk.height; i++) {
						const left = chunk.leftLines[i] ?? emptyLine(panelWidth);
						const right = chunk.rightLines[i] ?? emptyLine(panelWidth);
						result.push(mergeSideBySide(left, right, panelWidth));
					}
					// Bottom border: └────────────────────┘
					const bottomBorder = `\u2514${"\u2500".repeat(Math.max(0, contentWidth - 2))}\u2518`;
					result.push(screenLine([{ text: bottomBorder, style: borderStyle }]));
				}
				break;
			}
			case "judge": {
				// Top border: ╔══ Judge (Round N) ══════╗
				const judgeLabel = ` Judge (Round ${chunk.roundNumber}) `;
				const judgeRemain = Math.max(0, contentWidth - 2 - judgeLabel.length);
				const judgeTop = `\u2554\u2550${judgeLabel}${"\u2550".repeat(judgeRemain)}\u2557`;
				result.push(
					screenLine([
						{ text: judgeTop, style: { bold: true, color: "yellow" } },
					]),
				);
				// Content lines with side borders — wrap text to fit inside box
				const innerWidth = Math.max(0, contentWidth - 4); // 2 border + 2 padding
				for (const line of chunk.lines) {
					const rawText = line.segments.map((s) => s.text).join("");
					const wrappedLines = wrapText(rawText, innerWidth, {
						continuationIndent: 0,
						style: {},
					});
					for (const wl of wrappedLines) {
						const wlWidth = wl.segments.reduce(
							(w, s) => w + stringWidth(s.text),
							0,
						);
						const pad = Math.max(0, innerWidth - wlWidth);
						result.push(
							screenLine([
								{ text: "\u2551 ", style: { color: "yellow", dim: true } },
								...wl.segments,
								{
									text: `${" ".repeat(pad)} \u2551`,
									style: { color: "yellow", dim: true },
								},
							]),
						);
					}
				}
				// Decision line
				if (chunk.status === "done") {
					let decisionText = "";
					if (chunk.shouldContinue === false) {
						decisionText = "\u2717 Judge decided to end debate";
					} else if (chunk.shouldContinue === true) {
						decisionText = "\u2713 Continuing to next round";
					}
					if (decisionText) {
						const decisionColor = chunk.shouldContinue ? "green" : "red";
						const decisionInner = Math.max(0, contentWidth - 4);
						const decisionPad = Math.max(
							0,
							decisionInner - decisionText.length,
						);
						result.push(
							screenLine([
								{ text: "\u2551 ", style: { color: "yellow", dim: true } },
								{
									text: decisionText,
									style: { bold: true, color: decisionColor },
								},
								{
									text: `${" ".repeat(decisionPad)} \u2551`,
									style: { color: "yellow", dim: true },
								},
							]),
						);
					}
				}
				// Bottom border: ╚══════════════════════╝
				const judgeBottom = `\u255A${"\u2550".repeat(Math.max(0, contentWidth - 2))}\u255D`;
				result.push(
					screenLine([
						{ text: judgeBottom, style: { bold: true, color: "yellow" } },
					]),
				);
				break;
			}
			case "summary": {
				result.push(
					screenLine([
						{
							text: "\u2550\u2550 Final Summary \u2550\u2550",
							style: { bold: true },
						},
					]),
				);
				// Wrap each summary line to fit contentWidth
				for (const line of chunk.lines) {
					const rawText = line.segments.map((s) => s.text).join("");
					const style = line.segments[0]?.style ?? {};
					const wrapped = wrapText(rawText, contentWidth, {
						continuationIndent: 2,
						style,
					});
					result.push(...wrapped);
				}
				break;
			}
		}
	}

	return result;
}
