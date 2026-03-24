import stringWidth from "string-width";
import type { ScreenLine, StyledSegment } from "../state/types.js";

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

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let result = "";
  let currentWidth = 0;

  for (const { segment } of segmenter.segment(text)) {
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
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
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
    for (const { segment } of segmenter.segment(rawLine)) {
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
