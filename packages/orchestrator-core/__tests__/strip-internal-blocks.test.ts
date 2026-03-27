import { describe, expect, it } from "vitest";
import { stripInternalBlocks } from "../src/strip-internal-blocks.js";

describe("stripInternalBlocks", () => {
	it("strips fenced debate_meta blocks", () => {
		const input = '```debate_meta\n{"confidence":0.8}\n```\nActual content.';
		expect(stripInternalBlocks(input)).toBe("Actual content.");
	});

	it("strips fenced judge_verdict blocks", () => {
		const input = 'Some text\n```judge_verdict\n{"score":5}\n```\nMore text.';
		expect(stripInternalBlocks(input)).toBe("Some text\nMore text.");
	});

	it("strips unclosed fenced blocks at end of string", () => {
		const input = 'Content here.\n```debate_meta\n{"confidence":0.8}';
		expect(stripInternalBlocks(input)).toBe("Content here.");
	});

	it("strips unfenced meta blocks at end of string", () => {
		const input = 'Content here.\ndebate_meta\n{"confidence":0.8}\n';
		expect(stripInternalBlocks(input)).toBe("Content here.");
	});

	it("strips unfenced judge_verdict blocks at end of string", () => {
		const input = 'Challenge text\njudge_verdict\n{"score":5}\n';
		expect(stripInternalBlocks(input)).toBe("Challenge text");
	});

	it("returns empty string for meta-only content", () => {
		const input = '```debate_meta\n{"confidence":0.8}\n```';
		expect(stripInternalBlocks(input)).toBe("");
	});

	it("returns original text when no meta blocks present", () => {
		const input = "Just normal text with no meta blocks.";
		expect(stripInternalBlocks(input)).toBe(input);
	});

	it("handles empty string", () => {
		expect(stripInternalBlocks("")).toBe("");
	});
});
