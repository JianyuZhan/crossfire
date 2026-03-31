import { describe, expect, it } from "vitest";
import {
	type MarkdownReportMeta,
	renderMarkdownToHtml,
} from "../src/markdown-renderer.js";

const meta: MarkdownReportMeta = {
	topic: "Test Topic",
	roundsCompleted: 3,
	date: "2026-03-25",
	participants: { proposer: "claude", challenger: "gemini", judge: "claude" },
	generationQuality: "llm-full",
};

describe("renderMarkdownToHtml", () => {
	it("renders sections as HTML cards", () => {
		const md =
			"## Executive Summary\n\nThis is the summary.\n\n## Consensus\n\n- Item 1\n- Item 2";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).toContain("<h2");
		expect(html).toContain("Executive Summary");
		expect(html).toContain("This is the summary.");
		expect(html).toContain("<li>");
	});

	it("escapes HTML in input before rendering markdown", () => {
		const md = "## Test\n\n<script>alert('xss')</script>";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("renders bold and italic", () => {
		const md = "## Test\n\n**bold text** and *italic text*";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).toContain("<strong>bold text</strong>");
		expect(html).toContain("<em>italic text</em>");
	});

	it("renders inline code", () => {
		const md = "## Test\n\nUse `npm install` here";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).toContain("<code>npm install</code>");
	});

	it("renders safe links but blocks javascript: URLs", () => {
		const md =
			"## Test\n\n[safe](https://example.com) and [bad](javascript:alert(1))";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).toContain('href="https://example.com"');
		expect(html).not.toContain("javascript:");
	});

	it("renders markdown tables as HTML tables", () => {
		const md = "## Test\n\n| A | B |\n|---|---|\n| 1 | 2 |";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).toContain("<table>");
		expect(html).toContain("<th>");
		expect(html).toContain("<td>");
	});

	it("includes quality notice for local-structured", () => {
		const localMeta: MarkdownReportMeta = {
			...meta,
			generationQuality: "local-structured",
		};
		const md = "## Summary\n\nContent";
		const html = renderMarkdownToHtml(md, localMeta);
		expect(html).toContain("structured debate metadata");
	});

	it("includes stronger notice for local-degraded", () => {
		const degradedMeta: MarkdownReportMeta = {
			...meta,
			generationQuality: "local-degraded",
		};
		const md = "## Summary\n\nContent";
		const html = renderMarkdownToHtml(md, degradedMeta);
		expect(html).toContain("limited data");
	});

	it("no prominent notice for llm-full quality", () => {
		const md = "## Summary\n\nContent";
		const html = renderMarkdownToHtml(md, meta);
		expect(html).not.toContain("structured debate metadata");
		expect(html).not.toContain("limited data");
	});

	it("includes a recovery notice for llm-recovered", () => {
		const recoveredMeta: MarkdownReportMeta = {
			...meta,
			generationQuality: "llm-recovered",
		};
		const md = "## Summary\n\nContent";
		const html = renderMarkdownToHtml(md, recoveredMeta);
		expect(html).toContain("recovered from ExitPlanMode");
	});
});
