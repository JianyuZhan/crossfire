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
	it("renders collapsed round as 3 lines (no embedded judge)", () => {
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

	it("renders judge as separate chunk after round", () => {
		const round: RoundRenderChunk = {
			type: "round",
			roundNumber: 1,
			maxRounds: 3,
			active: false,
			collapsed: false,
			leftLines: [makeLine("left", 10)],
			rightLines: [makeLine("right", 10)],
			height: 1,
		};
		const judge: JudgeRenderChunk = {
			type: "judge",
			roundNumber: 1,
			status: "done",
			shouldContinue: true,
			lines: [makeLine("Both sides valid.")],
		};
		const lines = buildGlobalLineBuffer([round, judge], 43);
		const allText = lines.map(lineText).join("\n");
		// Round: top-border + content + bottom-border
		expect(allText).toContain("Round 1");
		// Judge: double-line border box
		expect(allText).toContain("Judge");
		expect(allText).toContain("\u2554"); // ╔
		expect(allText).toContain("\u2713"); // ✓ Continuing
	});

	it("renders expanded round without judge when no judge chunk follows", () => {
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

	it("active judge chunk renders with bordered box", () => {
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

	it("judge content wraps long text within bordered box", () => {
		const longText =
			"This is a very long judge evaluation text that should be wrapped to fit within the bordered box boundaries properly.";
		const judge: JudgeRenderChunk = {
			type: "judge",
			roundNumber: 2,
			status: "done",
			shouldContinue: false,
			lines: [makeLine(longText, longText.length)],
		};
		// Use narrow width to force wrapping
		const lines = buildGlobalLineBuffer([judge], 40);
		const allText = lines.map(lineText).join("\n");
		// Should have top border + multiple wrapped lines + decision + bottom border
		expect(lines.length).toBeGreaterThan(4);
		expect(allText).toContain("Judge (Round 2)");
		expect(allText).toContain("\u2717"); // ✗ ended
	});
});
