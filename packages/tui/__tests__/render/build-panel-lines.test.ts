import { describe, expect, it } from "vitest";
import { buildPanelLines } from "../../src/render/line-buffer.js";
import type { RenderBlock } from "../../src/state/types.js";

describe("buildPanelLines", () => {
	it("renders agent-header as exactly 2 lines", () => {
		const blocks: RenderBlock[] = [
			{
				kind: "agent-header",
				role: "proposer",
				agentType: "claude",
				status: "speaking",
				duration: 1500,
			},
		];
		const lines = buildPanelLines(blocks, 40);
		expect(lines).toHaveLength(2);
	});

	it("renders message with preceding blank line", () => {
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "proposer", status: "done" },
			{ kind: "message", text: "Hello", isFinal: true },
		];
		const lines = buildPanelLines(blocks, 40);
		// 2 (header) + 1 (blank) + 1 (message) = 4
		expect(lines).toHaveLength(4);
	});

	it("renders tool-call as single line", () => {
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "challenger", status: "tool" },
			{
				kind: "tool-call",
				toolName: "debate_meta",
				status: "success",
				summary: "scores",
			},
		];
		const lines = buildPanelLines(blocks, 40);
		// 2 (header) + 1 (tool) = 3
		expect(lines).toHaveLength(3);
	});

	it("limits error to max 3 lines", () => {
		const longError = "A".repeat(200);
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "proposer", status: "error" },
			{ kind: "error", text: longError },
		];
		const lines = buildPanelLines(blocks, 40);
		// 2 (header) + max 3 (error) = 5
		expect(lines.length).toBeLessThanOrEqual(5);
	});

	it("all lines respect panelWidth", () => {
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "proposer", status: "speaking" },
			{ kind: "message", text: "A".repeat(100), isFinal: false },
		];
		const lines = buildPanelLines(blocks, 30);
		for (const line of lines) {
			expect(line.displayWidth).toBeLessThanOrEqual(30);
		}
	});
});
