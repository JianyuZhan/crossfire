import { describe, expect, it } from "vitest";
import { buildStatelessPrompt } from "../src/prompt-builder.js";

describe("buildStatelessPrompt", () => {
	it("includes current prompt at end", () => {
		const result = buildStatelessPrompt("What next?", []);
		expect(result.endsWith("What next?")).toBe(true);
	});

	it("summary mode: includes turn summaries", () => {
		const history = [
			{ role: "user", summary: "Asked about X" },
			{ role: "assistant", summary: "Explained X in detail" },
		];
		const result = buildStatelessPrompt("Follow up", history, "summary");
		expect(result).toContain("Asked about X");
		expect(result).toContain("Explained X in detail");
		expect(result).toContain("Follow up");
	});

	it("does not include finalText in summary mode", () => {
		const history = [
			{
				role: "assistant",
				summary: "Short summary",
				finalText: "Very long full response...",
			},
		];
		const result = buildStatelessPrompt("Next", history, "summary");
		expect(result).toContain("Short summary");
		expect(result).not.toContain("Very long full response");
	});

	it("empty history: just the prompt", () => {
		const result = buildStatelessPrompt("Hello", []);
		expect(result).toBe("Hello");
	});

	it("preserves order of history entries", () => {
		const history = [
			{ role: "user", summary: "First" },
			{ role: "assistant", summary: "Second" },
			{ role: "user", summary: "Third" },
		];
		const result = buildStatelessPrompt("Fourth", history);
		const firstIdx = result.indexOf("First");
		const secondIdx = result.indexOf("Second");
		const thirdIdx = result.indexOf("Third");
		const fourthIdx = result.indexOf("Fourth");
		expect(firstIdx).toBeLessThan(secondIdx);
		expect(secondIdx).toBeLessThan(thirdIdx);
		expect(thirdIdx).toBeLessThan(fourthIdx);
	});
});
