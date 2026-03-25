import { describe, expect, it } from "vitest";
import {
	emptyLine,
	padRight,
	screenLine,
	truncate,
	wrapText,
} from "../../src/render/line-buffer.js";

describe("truncate", () => {
	it("returns text unchanged when within width", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates with ellipsis when over width", () => {
		expect(truncate("hello world", 8)).toBe("hello w…");
	});

	it("handles CJK characters (2-col width)", () => {
		expect(truncate("你好世界测试", 8)).toBe("你好世…");
	});

	it("handles empty string", () => {
		expect(truncate("", 10)).toBe("");
	});
});

describe("screenLine", () => {
	it("creates a ScreenLine with computed displayWidth", () => {
		const line = screenLine([{ text: "hello", style: {} }]);
		expect(line.displayWidth).toBe(5);
		expect(line.segments).toHaveLength(1);
	});
});

describe("emptyLine", () => {
	it("creates a line of spaces with exact displayWidth", () => {
		const line = emptyLine(10);
		expect(line.displayWidth).toBe(10);
		expect(line.segments[0].text).toBe("          ");
	});
});

describe("padRight", () => {
	it("pads line to target width with spaces", () => {
		const line = screenLine([{ text: "hi", style: {} }]);
		const padded = padRight(line, 10);
		expect(padded.displayWidth).toBe(10);
	});

	it("returns unchanged if already at target width", () => {
		const line = screenLine([{ text: "hello", style: {} }]);
		const padded = padRight(line, 5);
		expect(padded.displayWidth).toBe(5);
		expect(padded.segments).toHaveLength(1);
	});
});

describe("wrapText", () => {
	it("wraps long text at word boundaries", () => {
		const lines = wrapText("hello world foo bar", 11, { style: {} });
		expect(lines).toHaveLength(2);
		expect(lines[0].segments[0].text).toBe("hello world");
		expect(lines[1].segments[0].text).toBe("foo bar");
	});

	it("force-breaks words longer than maxWidth", () => {
		const lines = wrapText("abcdefghij", 5, { style: {} });
		expect(lines).toHaveLength(2);
		expect(lines[0].displayWidth).toBeLessThanOrEqual(5);
		expect(lines[1].displayWidth).toBeLessThanOrEqual(5);
	});

	it("handles newlines in text", () => {
		const lines = wrapText("line1\nline2", 20, { style: {} });
		expect(lines).toHaveLength(2);
	});

	it("applies firstLinePrefix", () => {
		const prefix = [{ text: ">> ", style: { dim: true } }];
		const lines = wrapText("hello world foo", 15, {
			firstLinePrefix: prefix,
			continuationIndent: 3,
			style: {},
		});
		expect(lines[0].segments[0].text).toBe(">> ");
		expect(lines[1].segments[0].text).toMatch(/^\s{3}/);
	});

	it("returns single empty line for empty string", () => {
		const lines = wrapText("", 20, { style: {} });
		expect(lines).toHaveLength(1);
		expect(lines[0].displayWidth).toBe(0);
	});

	it("handles CJK wrapping", () => {
		const lines = wrapText("你好世界啊", 6, { style: {} });
		expect(lines.length).toBeGreaterThanOrEqual(2);
		for (const line of lines) {
			expect(line.displayWidth).toBeLessThanOrEqual(6);
		}
	});
});
