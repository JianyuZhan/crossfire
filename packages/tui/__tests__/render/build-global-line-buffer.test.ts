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

function lineText(line: ScreenLine): string {
  return line.segments.map((s) => s.text).join("");
}

describe("buildGlobalLineBuffer", () => {
  it("renders collapsed round as 3 lines without judge", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      maxRounds: 3,
      active: false,
      collapsed: true,
      collapsedSummary: {
        proposerLine: "Proposer argument about microservices",
        challengerLine: "Challenger rebuttal about monolith",
      },
      leftLines: [],
      rightLines: [],
      height: 0,
    };
    const lines = buildGlobalLineBuffer([chunk], 80);
    expect(lines).toHaveLength(3);
    expect(lineText(lines[0])).toContain("Round 1");
    expect(lineText(lines[1])).toContain("P:");
    expect(lineText(lines[1])).toContain("Proposer argument");
    expect(lineText(lines[2])).toContain("C:");
    expect(lineText(lines[2])).toContain("Challenger rebuttal");
  });

  it("renders collapsed round as 4 lines with judge", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      maxRounds: 3,
      active: false,
      collapsed: true,
      collapsedSummary: {
        proposerLine: "Proposer text",
        challengerLine: "Challenger text",
        judgeLine: "Both valid. \u2192 Continue | P leads 7-5",
      },
      leftLines: [],
      rightLines: [],
      height: 0,
    };
    const lines = buildGlobalLineBuffer([chunk], 80);
    expect(lines).toHaveLength(4);
    expect(lineText(lines[3])).toContain("\u2696");
    expect(lineText(lines[3])).toContain("Continue");
  });

  it("renders expanded round with embedded judge section after bottom border", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      maxRounds: 3,
      active: false,
      collapsed: false,
      leftLines: [makeLine("left", 10)],
      rightLines: [makeLine("right", 10)],
      height: 1,
      judgeResult: {
        roundNumber: 1,
        status: "done",
        messageText: "Both sides valid.",
        verdict: {
          leading: "proposer",
          score: { proposer: 7, challenger: 5 },
          reasoning: "Proposer had stronger evidence",
          shouldContinue: true,
        },
      },
    };
    const lines = buildGlobalLineBuffer([chunk], 43);
    // top-border(1) + content(1) + bottom-border(1) + judge-header(1) + judge-text(1) + decision(1) = 6
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const allText = lines.map(lineText).join("\n");
    expect(allText).toContain("\u2696 Judge");
    expect(allText).toContain("Continue");
  });

  it("renders expanded round without judge section when no judgeResult", () => {
    const chunk: RoundRenderChunk = {
      type: "round",
      roundNumber: 1,
      maxRounds: 3,
      active: false,
      collapsed: false,
      leftLines: [makeLine("left1", 10), makeLine("left2", 10)],
      rightLines: [makeLine("right1", 10)],
      height: 2,
    };
    const lines = buildGlobalLineBuffer([chunk], 43);
    expect(lines).toHaveLength(4); // top + 2 content + bottom
  });

  it("active judge chunk still renders with bordered box", () => {
    const judge: JudgeRenderChunk = {
      type: "judge",
      roundNumber: 1,
      status: "streaming",
      lines: [makeLine("Evaluating...")],
    };
    const lines = buildGlobalLineBuffer([judge], 80);
    const allText = lines.map(lineText).join("");
    expect(allText).toContain("Judge");
    expect(allText).toContain("\u2554");
  });
});
