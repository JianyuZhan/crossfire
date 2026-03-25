// packages/tui/__tests__/state/viewport.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { TuiStore } from "../../src/state/tui-store.js";

describe("TuiStore viewport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("initializes with autoFollow=true and scrollOffset=0", () => {
		const store = new TuiStore();
		const vp = store.getViewport();
		expect(vp.autoFollow).toBe(true);
		expect(vp.scrollOffset).toBe(0);
	});

	it("scroll up sets autoFollow=false", () => {
		const store = new TuiStore();
		store.setViewportDimensions(20, 80);
		(store as any).globalLines = Array.from({ length: 50 }, () => ({
			segments: [],
			displayWidth: 0,
		}));
		store.scroll(-5);
		expect(store.getViewport().autoFollow).toBe(false);
		expect(store.getViewport().scrollOffset).toBe(5);
	});

	it("scroll down near bottom restores autoFollow", () => {
		const store = new TuiStore();
		store.setViewportDimensions(20, 80);
		(store as any).globalLines = Array.from({ length: 50 }, () => ({
			segments: [],
			displayWidth: 0,
		}));
		store.scroll(-10);
		expect(store.getViewport().autoFollow).toBe(false);
		store.scroll(9);
		expect(store.getViewport().autoFollow).toBe(true);
		expect(store.getViewport().scrollOffset).toBe(0);
	});

	it("scrollToTop sets offset to max", () => {
		const store = new TuiStore();
		store.setViewportDimensions(20, 80);
		(store as any).globalLines = Array.from({ length: 50 }, () => ({
			segments: [],
			displayWidth: 0,
		}));
		store.scrollToTop();
		expect(store.getViewport().scrollOffset).toBe(30); // 50-20
		expect(store.getViewport().autoFollow).toBe(false);
	});

	it("scrollToBottom restores autoFollow", () => {
		const store = new TuiStore();
		store.scroll(-10);
		store.scrollToBottom();
		expect(store.getViewport().scrollOffset).toBe(0);
		expect(store.getViewport().autoFollow).toBe(true);
	});

	it("autoFollow pins round header to viewport top when active content is short", () => {
		const store = new TuiStore();
		store.setViewportDimensions(24, 80);

		// Simulate debate start + round 1
		store.handleEvent({
			kind: "debate.started",
			timestamp: 0,
			debateId: "d1",
			config: {
				topic: "T",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			roles: {
				proposer: { agentType: "claude_code" },
				challenger: { agentType: "codex" },
			},
		} as any);
		store.handleEvent({
			kind: "round.started",
			timestamp: 1,
			roundNumber: 1,
			speaker: "proposer",
		} as any);

		// Proposer produces many lines of content
		for (let i = 0; i < 40; i++) {
			store.handleEvent({
				kind: "message.delta",
				timestamp: 2 + i,
				text: `Proposer line ${i}\n`,
			} as any);
		}
		store.handleEvent({
			kind: "message.final",
			timestamp: 50,
			text: Array.from({ length: 40 }, (_, i) => `Proposer line ${i}`).join(
				"\n",
			),
		} as any);
		store.handleEvent({
			kind: "turn.completed",
			timestamp: 51,
			status: "completed",
			durationMs: 50,
		} as any);
		store.handleEvent({
			kind: "round.completed",
			timestamp: 52,
			roundNumber: 1,
			speaker: "proposer",
		} as any);

		// Challenger starts — only a few lines of content
		store.handleEvent({
			kind: "round.started",
			timestamp: 53,
			roundNumber: 1,
			speaker: "challenger",
		} as any);
		store.handleEvent({
			kind: "thinking.delta",
			timestamp: 54,
			text: "Thinking...",
		} as any);

		// Force flush to update layout
		store.forceFlush();

		const vp = store.getViewport();
		expect(vp.autoFollow).toBe(true);

		// The round header should be visible (near the top of viewport).
		// With the old logic, the view would be near the active content's end (line 3-4 of the round),
		// showing mostly old collapsed content above. With the fix, the round header is at viewport top.
		const visible = store.getVisibleLines();
		const visibleText = visible
			.map((l) => l.segments.map((s) => s.text).join(""))
			.join("\n");
		// The active round header should be visible
		expect(visibleText).toContain("Round 1/10");
	});

	it("autoFollow follows active content bottom when content exceeds viewport", () => {
		const store = new TuiStore();
		store.setViewportDimensions(10, 80);

		store.handleEvent({
			kind: "debate.started",
			timestamp: 0,
			debateId: "d1",
			config: {
				topic: "T",
				maxRounds: 10,
				judgeEveryNRounds: 3,
				convergenceThreshold: 0.3,
			},
			roles: {
				proposer: { agentType: "claude_code" },
				challenger: { agentType: "codex" },
			},
		} as any);
		store.handleEvent({
			kind: "round.started",
			timestamp: 1,
			roundNumber: 1,
			speaker: "proposer",
		} as any);

		// Proposer produces lots of content (exceeds viewport height)
		const longText = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join(
			"\n",
		);
		store.handleEvent({
			kind: "message.delta",
			timestamp: 2,
			text: longText,
		} as any);
		store.forceFlush();

		const vp = store.getViewport();
		expect(vp.autoFollow).toBe(true);

		// With content exceeding viewport, the latest content should be at viewport bottom
		const visible = store.getVisibleLines();
		const visibleText = visible
			.map((l) => l.segments.map((s) => s.text).join(""))
			.join("\n");
		// Should see content near the end, not the round header
		expect(visibleText).toContain("Line 29");
	});

	it("getVisibleLines slices from bottom when offset=0", () => {
		const store = new TuiStore();
		store.setViewportDimensions(3, 80);
		const lines = Array.from({ length: 10 }, (_, i) => ({
			segments: [{ text: `line${i}`, style: {} }],
			displayWidth: 5,
		}));
		(store as any).globalLines = lines;
		const visible = store.getVisibleLines();
		expect(visible).toHaveLength(3);
		expect(visible[0].segments[0].text).toBe("line7");
		expect(visible[2].segments[0].text).toBe("line9");
	});
});
