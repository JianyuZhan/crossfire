import type { AuditReport } from "./draft-report.js";

export interface ReportMeta {
	topic: string;
	roundsCompleted: number;
	date: string;
	participants: { proposer: string; challenger: string; judge?: string };
	generationQuality: "full" | "draft-filled" | "draft-minimal";
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function esc(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Renders the audit report as a complete HTML document.
 */
export function renderActionPlanHtml(
	report: AuditReport,
	meta: ReportMeta,
): string {
	const executiveSummaryParagraphs = report.executiveSummary
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);

	let qualityBadge: string;
	if (meta.generationQuality === "full") {
		qualityBadge = '<span class="badge badge-green">Enhanced synthesis</span>';
	} else if (meta.generationQuality === "draft-filled") {
		qualityBadge = '<span class="badge badge-yellow">Fallback synthesis</span>';
	} else {
		qualityBadge = '<span class="badge badge-red">Minimal fallback</span>';
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Crossfire Debate Report: ${esc(meta.topic)}</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			line-height: 1.6;
			color: #333;
			background: #f5f5f5;
			padding: 2rem 1rem;
		}
		.container {
			max-width: 900px;
			margin: 0 auto;
			background: white;
			padding: 2rem;
			box-shadow: 0 2px 8px rgba(0,0,0,0.1);
			border-radius: 8px;
		}
		h1 {
			color: #1a1a1a;
			margin-bottom: 0.5rem;
			font-size: 2rem;
		}
		h2 {
			color: #2a2a2a;
			margin-top: 2rem;
			margin-bottom: 1rem;
			padding-bottom: 0.5rem;
			border-bottom: 2px solid #e0e0e0;
			font-size: 1.5rem;
		}
		h3 {
			color: #3a3a3a;
			margin-top: 1.5rem;
			margin-bottom: 0.5rem;
			font-size: 1.2rem;
		}
		.meta {
			color: #666;
			margin-bottom: 1rem;
			font-size: 0.95rem;
		}
		.badge {
			display: inline-block;
			padding: 0.25rem 0.75rem;
			border-radius: 4px;
			font-size: 0.85rem;
			font-weight: 600;
			margin-bottom: 1rem;
		}
		.badge-green {
			background: #d4edda;
			color: #155724;
		}
		.badge-yellow {
			background: #fff3cd;
			color: #856404;
		}
		.badge-red {
			background: #f8d7da;
			color: #721c24;
		}
		.card {
			background: #fafafa;
			border: 1px solid #e0e0e0;
			border-radius: 6px;
			padding: 1.25rem;
			margin-bottom: 1rem;
		}
		.card-consensus {
			border-left: 4px solid #0066cc;
		}
		.card-unresolved {
			border-left: 4px solid #cc0000;
		}
		.card-title {
			font-weight: 600;
			color: #1a1a1a;
			margin-bottom: 0.5rem;
			font-size: 1.1rem;
		}
		.card-section {
			margin-top: 0.75rem;
		}
		.card-label {
			font-weight: 600;
			color: #555;
			margin-bottom: 0.25rem;
		}
		ul {
			margin-left: 1.5rem;
			margin-top: 0.5rem;
		}
		li {
			margin-bottom: 0.25rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			margin-top: 1rem;
			background: white;
		}
		th, td {
			text-align: left;
			padding: 0.75rem;
			border: 1px solid #ddd;
		}
		th {
			background: #f0f0f0;
			font-weight: 600;
			color: #333;
		}
		tr:hover {
			background: #f9f9f9;
		}
		details {
			margin-bottom: 1rem;
			border: 1px solid #e0e0e0;
			border-radius: 6px;
			padding: 0.75rem;
			background: #fafafa;
		}
		summary {
			cursor: pointer;
			font-weight: 600;
			color: #0066cc;
			padding: 0.25rem 0;
		}
		summary:hover {
			color: #0052a3;
		}
		details[open] summary {
			margin-bottom: 0.75rem;
		}
		.position {
			margin-bottom: 0.75rem;
		}
		.position-label {
			font-weight: 600;
			color: #555;
		}
		@media (max-width: 768px) {
			body {
				padding: 1rem 0.5rem;
			}
			.container {
				padding: 1.5rem;
			}
			h1 {
				font-size: 1.5rem;
			}
			h2 {
				font-size: 1.3rem;
			}
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>Crossfire Debate Report</h1>
		<div class="meta">
			<strong>Topic:</strong> ${esc(meta.topic)}<br>
			<strong>Rounds:</strong> ${meta.roundsCompleted}<br>
			<strong>Date:</strong> ${esc(meta.date)}<br>
			<strong>Participants:</strong> Proposer: ${esc(meta.participants.proposer)}, Challenger: ${esc(meta.participants.challenger)}${meta.participants.judge ? `, Judge: ${esc(meta.participants.judge)}` : ""}
		</div>
		${qualityBadge}

		<h2>Executive Summary</h2>
		${executiveSummaryParagraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("\n\t\t")}

		<h2>Consensus</h2>
		${report.consensusItems
			.map(
				(item) => `
		<div class="card card-consensus">
			<div class="card-title">${esc(item.title)}</div>
			<p>${esc(item.detail)}</p>
			<div class="card-section">
				<div class="card-label">Next Steps:</div>
				<p>${esc(item.nextSteps)}</p>
			</div>
			${
				item.supportingEvidence.length > 0
					? `
			<div class="card-section">
				<div class="card-label">Supporting Evidence:</div>
				<ul>
					${item.supportingEvidence.map((ev) => `<li>${esc(ev)}</li>`).join("")}
				</ul>
			</div>
			`
					: ""
			}
		</div>
		`,
			)
			.join("")}

		<h2>Unresolved Issues</h2>
		${report.unresolvedIssues
			.map(
				(issue) => `
		<div class="card card-unresolved">
			<div class="card-title">${esc(issue.title)}</div>
			<div class="position">
				<span class="position-label">Proposer:</span> ${esc(issue.proposerPosition)}
			</div>
			<div class="position">
				<span class="position-label">Challenger:</span> ${esc(issue.challengerPosition)}
			</div>
			<div class="card-section">
				<div class="card-label">Risk:</div>
				<p>${esc(issue.risk)}</p>
			</div>
			<div class="card-section">
				<div class="card-label">Suggested Exploration:</div>
				<p>${esc(issue.suggestedExploration)}</p>
			</div>
		</div>
		`,
			)
			.join("")}

		<h2>Argument Evolution</h2>
		${report.argumentEvolution
			.map(
				(arg) => `
		<details>
			<summary>${esc(arg.argument)}</summary>
			<div class="card-section">
				<div class="card-label">Trajectory:</div>
				<p>${esc(arg.trajectory)}</p>
			</div>
			<div class="card-section">
				<div class="card-label">Final Status:</div>
				<p>${esc(arg.finalStatus)}</p>
			</div>
		</details>
		`,
			)
			.join("")}

		<h2>Risk Matrix</h2>
		<table>
			<thead>
				<tr>
					<th>Risk</th>
					<th>Severity</th>
					<th>Likelihood</th>
					<th>Mitigation</th>
				</tr>
			</thead>
			<tbody>
				${report.riskMatrix
					.map(
						(risk) => `
				<tr>
					<td>${esc(risk.risk)}</td>
					<td>${esc(risk.severity)}</td>
					<td>${esc(risk.likelihood)}</td>
					<td>${esc(risk.mitigation)}</td>
				</tr>
				`,
					)
					.join("")}
			</tbody>
		</table>

		<h2>Evidence Registry</h2>
		<table>
			<thead>
				<tr>
					<th>Claim</th>
					<th>Source</th>
					<th>Used By</th>
					<th>Contested</th>
				</tr>
			</thead>
			<tbody>
				${report.evidenceRegistry
					.map(
						(ev) => `
				<tr>
					<td>${esc(ev.claim)}</td>
					<td>${esc(ev.source)}</td>
					<td>${esc(ev.usedBy)}</td>
					<td>${ev.contested ? "Yes" : "No"}</td>
				</tr>
				`,
					)
					.join("")}
			</tbody>
		</table>
	</div>
</body>
</html>`;
}

/**
 * Renders the audit report as GitHub-flavored Markdown.
 */
export function renderActionPlanMarkdown(
	report: AuditReport,
	meta: ReportMeta,
): string {
	let md = `# Crossfire Debate Report

**Topic:** ${meta.topic}
**Rounds:** ${meta.roundsCompleted}
**Date:** ${meta.date}
**Participants:** Proposer: ${meta.participants.proposer}, Challenger: ${meta.participants.challenger}${meta.participants.judge ? `, Judge: ${meta.participants.judge}` : ""}

## Executive Summary

${report.executiveSummary}

## Consensus

`;

	for (const item of report.consensusItems) {
		md += `### ${item.title}

${item.detail}

**Next Steps:** ${item.nextSteps}

`;
		if (item.supportingEvidence.length > 0) {
			md += "**Supporting Evidence:**\n";
			for (const ev of item.supportingEvidence) {
				md += `- ${ev}\n`;
			}
			md += "\n";
		}
	}

	md += "## Unresolved Issues\n\n";

	for (const issue of report.unresolvedIssues) {
		md += `### ${issue.title}

**Proposer:** ${issue.proposerPosition}

**Challenger:** ${issue.challengerPosition}

**Risk:** ${issue.risk}

**Suggested Exploration:** ${issue.suggestedExploration}

`;
	}

	md += "## Argument Evolution\n\n";

	for (const arg of report.argumentEvolution) {
		md += `- **${arg.argument}**\n`;
		md += `  - Trajectory: ${arg.trajectory}\n`;
		md += `  - Final Status: ${arg.finalStatus}\n`;
	}

	md += "\n## Risk Matrix\n\n";
	md += "| Risk | Severity | Likelihood | Mitigation |\n";
	md += "|------|----------|------------|------------|\n";

	for (const risk of report.riskMatrix) {
		md += `| ${risk.risk} | ${risk.severity} | ${risk.likelihood} | ${risk.mitigation} |\n`;
	}

	md += "\n## Evidence Registry\n\n";
	md += "| Claim | Source | Used By | Contested |\n";
	md += "|-------|--------|---------|----------|\n";

	for (const ev of report.evidenceRegistry) {
		md += `| ${ev.claim} | ${ev.source} | ${ev.usedBy} | ${ev.contested ? "Yes" : "No"} |\n`;
	}

	return md;
}
