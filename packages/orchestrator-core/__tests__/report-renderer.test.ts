import { describe, expect, it } from "vitest";
import type { AuditReport } from "../src/draft-report.js";
import {
	type ReportMeta,
	renderActionPlanHtml,
	renderActionPlanMarkdown,
} from "../src/report-renderer.js";

const sampleReport: AuditReport = {
	executiveSummary: "This debate examined X over 3 rounds.",
	consensusItems: [
		{
			title: "API-first design",
			detail: "Both sides agreed after round 2.",
			nextSteps: "Define OpenAPI spec.",
			supportingEvidence: ["Industry best practice"],
		},
	],
	unresolvedIssues: [
		{
			title: "Architecture choice",
			proposerPosition: "Microservices for scale",
			challengerPosition: "Monolith for simplicity",
			risk: "Wrong choice increases tech debt",
			suggestedExploration: "Run a spike with both approaches",
		},
	],
	argumentEvolution: [
		{
			argument: "Microservices",
			trajectory: "Proposed R1 → Challenged R2 → Weakened",
			finalStatus: "unresolved",
		},
	],
	riskMatrix: [
		{
			risk: "Complexity",
			severity: "high",
			likelihood: "medium",
			mitigation: "Start with modular monolith",
		},
	],
	evidenceRegistry: [
		{
			claim: "Netflix uses microservices",
			source: "Case study",
			usedBy: "proposer",
			contested: true,
		},
	],
};

const meta: ReportMeta = {
	topic: "Architecture decision",
	roundsCompleted: 3,
	date: "2026-03-25",
	participants: { proposer: "claude", challenger: "claude", judge: "claude" },
	generationQuality: "full",
};

describe("renderActionPlanHtml", () => {
	it("produces valid HTML with all 6 sections", () => {
		const html = renderActionPlanHtml(sampleReport, meta);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("Executive Summary");
		expect(html).toContain("Consensus");
		expect(html).toContain("Unresolved Issues");
		expect(html).toContain("Argument Evolution");
		expect(html).toContain("Risk Matrix");
		expect(html).toContain("Evidence Registry");
	});

	it("escapes HTML special characters", () => {
		const report = {
			...sampleReport,
			executiveSummary: "A <script>alert('xss')</script> test",
		};
		const html = renderActionPlanHtml(report, meta);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("renders multi-paragraph executive summaries as separate paragraphs", () => {
		const report = {
			...sampleReport,
			executiveSummary:
				"First paragraph with the top-level recommendation.\n\nSecond paragraph with judge assessment.",
		};
		const html = renderActionPlanHtml(report, meta);
		expect(html).toContain(
			"<p>First paragraph with the top-level recommendation.</p>",
		);
		expect(html).toContain("<p>Second paragraph with judge assessment.</p>");
	});

	it("shows generation quality badge", () => {
		const html = renderActionPlanHtml(sampleReport, meta);
		expect(html).toContain("Enhanced synthesis");
	});

	it("shows fallback badge for draft-filled quality", () => {
		const m = { ...meta, generationQuality: "draft-filled" as const };
		const html = renderActionPlanHtml(sampleReport, m);
		expect(html).toContain("Fallback synthesis");
	});

	it("uses details/summary for collapsible sections", () => {
		const html = renderActionPlanHtml(sampleReport, meta);
		expect(html).toContain("<details");
		expect(html).toContain("<summary");
	});
});

describe("renderActionPlanMarkdown", () => {
	it("produces markdown with all 6 sections", () => {
		const md = renderActionPlanMarkdown(sampleReport, meta);
		expect(md).toContain("# Crossfire Debate Report");
		expect(md).toContain("## Consensus");
		expect(md).toContain("## Unresolved Issues");
		expect(md).toContain("## Argument Evolution");
		expect(md).toContain("## Risk Matrix");
		expect(md).toContain("## Evidence Registry");
	});

	it("includes table formatting for risk matrix", () => {
		const md = renderActionPlanMarkdown(sampleReport, meta);
		expect(md).toContain("| Risk |");
		expect(md).toContain("| Complexity |");
	});
});
