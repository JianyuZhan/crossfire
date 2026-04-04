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
				preset: "research",
				status: "speaking",
				duration: 1500,
			},
		];
		const lines = buildPanelLines(blocks, 40);
		expect(lines).toHaveLength(2);
	});

	it("renders preset on the header line", () => {
		const blocks: RenderBlock[] = [
			{
				kind: "agent-header",
				role: "proposer",
				agentType: "claude",
				preset: "research",
				status: "thinking",
			},
		];
		const text = buildPanelLines(blocks, 80)
			.flatMap((line) => line.segments.map((segment) => segment.text))
			.join("\n");
		expect(text).toContain("Proposer [claude] [research]");
		expect(text).not.toContain("Thinking... [research]");
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

	it("wraps long tool-call lines instead of truncating them", () => {
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "challenger", status: "tool" },
			{
				kind: "tool-call",
				toolName: "WebFetch",
				status: "running",
				summary:
					'{"url":"https://example.com/really/long/path","prompt":"Explain the detailed architecture and edge cases"}',
			},
		];
		const lines = buildPanelLines(blocks, 36);
		expect(lines.length).toBeGreaterThan(3);
		const text = lines
			.slice(2)
			.flatMap((line) => line.segments.map((segment) => segment.text))
			.join("\n");
		expect(text).toContain("WebFetch");
		expect(text).toContain("https://example.com/real");
		expect(text).toContain('ly/long/path","prompt":"Explain');
	});

	it("renders tool-call elapsed time using human-readable seconds", () => {
		const blocks: RenderBlock[] = [
			{ kind: "agent-header", role: "challenger", status: "tool" },
			{
				kind: "tool-call",
				toolName: "WebFetch",
				status: "running",
				summary: '{"url":"https://example.com"}',
				elapsedMs: 2500,
			},
		];
		const text = buildPanelLines(blocks, 60)
			.flatMap((line) => line.segments.map((segment) => segment.text))
			.join("");
		expect(text).toContain("2.5s");
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

	it("renders plan and subagent blocks with readable text", () => {
		const blocks = [
			{ kind: "agent-header", role: "proposer", status: "tool" },
			{
				kind: "plan",
				steps: [{ title: "Inspect files", status: "in_progress" }],
			},
			{
				kind: "subagent",
				description: "Research the failing path",
				status: "running",
			},
		] as unknown as RenderBlock[];
		const text = buildPanelLines(blocks, 40)
			.flatMap((line) => line.segments.map((segment) => segment.text))
			.join("");
		expect(text).toContain("Inspect files");
		expect(text).toContain("Research the failing path");
	});

	it("renders warning badge on agent-header when warningCount > 0", () => {
		const blocks: RenderBlock[] = [
			{
				kind: "agent-header",
				role: "proposer",
				status: "thinking",
				preset: "research",
				warningCount: 3,
			},
		];
		const lines = buildPanelLines(blocks, 80);
		const text = lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
		expect(text).toContain("⚠3");
	});

	it("does not render warning badge when warningCount is 0", () => {
		const blocks: RenderBlock[] = [
			{
				kind: "agent-header",
				role: "proposer",
				status: "thinking",
				preset: "research",
				warningCount: 0,
			},
		];
		const lines = buildPanelLines(blocks, 80);
		const text = lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
		expect(text).not.toContain("⚠");
	});
});
