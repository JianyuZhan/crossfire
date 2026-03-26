// packages/adapter-core/__tests__/metrics.test.ts

import { describe, expect, it } from "vitest";
import { measureLocalMetrics } from "../src/metrics.js";

describe("measureLocalMetrics", () => {
	it("measures ASCII-only semantic text", () => {
		const metrics = measureLocalMetrics("Hello world", "");
		expect(metrics.semanticChars).toBe(11);
		expect(metrics.semanticUtf8Bytes).toBe(11);
		expect(metrics.adapterOverheadChars).toBe(0);
		expect(metrics.adapterOverheadUtf8Bytes).toBe(0);
		expect(metrics.totalChars).toBe(11);
		expect(metrics.totalUtf8Bytes).toBe(11);
	});

	it("measures UTF-8 multi-byte characters", () => {
		const semantic = "你好世界"; // 4 characters, 12 bytes in UTF-8
		const metrics = measureLocalMetrics(semantic, "");
		expect(metrics.semanticChars).toBe(4);
		expect(metrics.semanticUtf8Bytes).toBe(12);
		expect(metrics.totalChars).toBe(4);
		expect(metrics.totalUtf8Bytes).toBe(12);
	});

	it("separates semantic and overhead text", () => {
		const semantic = "User message";
		const overhead = "System: You are a helpful assistant.";
		const metrics = measureLocalMetrics(semantic, overhead);

		expect(metrics.semanticChars).toBe(12);
		expect(metrics.adapterOverheadChars).toBe(overhead.length);
		expect(metrics.totalChars).toBe(12 + overhead.length);
		expect(metrics.totalUtf8Bytes).toBe(
			metrics.semanticUtf8Bytes + metrics.adapterOverheadUtf8Bytes,
		);
	});

	it("defaults overheadText to empty string when omitted", () => {
		const metrics = measureLocalMetrics("Test");
		expect(metrics.adapterOverheadChars).toBe(0);
		expect(metrics.adapterOverheadUtf8Bytes).toBe(0);
		expect(metrics.totalChars).toBe(4);
	});

	it("handles empty semantic text", () => {
		const metrics = measureLocalMetrics("", "Overhead");
		expect(metrics.semanticChars).toBe(0);
		expect(metrics.semanticUtf8Bytes).toBe(0);
		expect(metrics.adapterOverheadChars).toBe(8);
		expect(metrics.totalChars).toBe(8);
	});

	it("handles emojis correctly (multi-byte)", () => {
		const semantic = "👍🎉"; // 2 visual characters, but 4 UTF-16 code units, 8 bytes in UTF-8
		const metrics = measureLocalMetrics(semantic, "");
		expect(metrics.semanticChars).toBe(4); // JavaScript .length counts UTF-16 code units
		expect(metrics.semanticUtf8Bytes).toBe(8);
	});
});
