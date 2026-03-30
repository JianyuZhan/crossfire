import { describe, expect, it } from "vitest";
import { mapCodexNotification } from "../src/event-mapper.js";

const CTX = {
	adapterId: "codex" as const,
	adapterSessionId: "s1",
	turnId: "t1",
};

describe("mapCodexNotification empty deltas", () => {
	it("ignores empty item/agentMessage/delta payloads", () => {
		expect(
			mapCodexNotification("item/agentMessage/delta", { text: "" }, CTX),
		).toEqual([]);
	});

	it("ignores empty reasoning summary deltas", () => {
		expect(
			mapCodexNotification(
				"item/reasoning/summaryTextDelta",
				{ text: "" },
				CTX,
			),
		).toEqual([]);
	});

	it("ignores reasoning item start events that do not carry text", () => {
		expect(
			mapCodexNotification(
				"item/started",
				{ item: { type: "reasoning", id: "r1" } },
				CTX,
			),
		).toEqual([]);
	});
});
