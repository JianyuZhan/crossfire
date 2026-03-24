import { describe, expect, it } from "vitest";
import { buildGlobalLineBuffer } from "../../src/render/line-buffer.js";
import type {
  JudgeRenderChunk,
  RoundRenderChunk,
  ScreenLine,
} from "../../src/state/types.js";

function makeLine(text: string, width?: number): ScreenLine {
  return {
    segments: [{ text, style: {} }],
    displayWidth: width ?? text.length,
  };
}

describe("buildGlobalLineBuffer", () => {
  it("renders collapsed round as single line", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      collapsed: true,
      collapsedSummary: "P: hello... | C: world...",
      leftLines: [],
      rightLines: [],
      height: 0,
    };
    const lines = buildGlobalLineBuffer([chunk], 80);
    expect(lines).toHaveLength(1);
    expect(lines[0].segments.some((s) => s.text.includes("Round 1"))).toBe(
      true,
    );
  });

  it("renders expanded round with side-by-side merge", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      collapsed: false,
      leftLines: [makeLine("left1", 10), makeLine("left2", 10)],
      rightLines: [makeLine("right1", 10)],
      height: 2,
    };
    // contentWidth=43 => panelWidth=floor((43-3)/2)=20
    const lines = buildGlobalLineBuffer([chunk], 43);
    // 1 top-border + 2 merged rows + 1 bottom-border = 4
    expect(lines).toHaveLength(4);
  });

  it("inserts separator between chunks", () => {
    const r1: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      collapsed: true,
      collapsedSummary: "test",
      leftLines: [],
      rightLines: [],
      height: 0,
    };
    const judge: JudgeRenderChunk = {
      type: "judge",
      roundNumber: 1,
      status: "done",
      lines: [makeLine("verdict text")],
    };
    const lines = buildGlobalLineBuffer([r1, judge], 80);
    // 1 (collapsed) + 1 (separator) + 1 (judge header) + 1 (judge content) = 4
    expect(lines).toHaveLength(4);
  });
});
