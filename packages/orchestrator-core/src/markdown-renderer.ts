/** Escape HTML special characters FIRST, before any markdown substitution. */
function escHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Only allow safe URL schemes for link rendering. */
function isSafeUrl(url: string): boolean {
	const trimmed = url.trim().toLowerCase();
	return (
		trimmed.startsWith("http:") ||
		trimmed.startsWith("https:") ||
		trimmed.startsWith("mailto:")
	);
}

/** Convert inline markdown patterns to HTML (operates on already-escaped text). */
function inlineMarkdown(escaped: string): string {
	let result = escaped;
	result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	result = result.replace(
		/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
		"<em>$1</em>",
	);
	result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
		const decodedUrl = url.replace(/&amp;/g, "&");
		if (isSafeUrl(decodedUrl)) {
			return `<a href="${url}">${text}</a>`;
		}
		// Strip unsafe URLs entirely for security
		return text;
	});
	return result;
}

/** Render a block of lines (already HTML-escaped) with list and table support. */
function renderBlock(lines: string[]): string {
	const output: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Table detection: line with | separators followed by |---|
		if (
			line.includes("|") &&
			i + 1 < lines.length &&
			/^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())
		) {
			const headerCells = line
				.split("|")
				.filter((c) => c.trim())
				.map((c) => c.trim());
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i].includes("|")) {
				rows.push(
					lines[i]
						.split("|")
						.filter((c) => c.trim())
						.map((c) => c.trim()),
				);
				i++;
			}
			output.push("<table>");
			output.push(
				`<thead><tr>${headerCells.map((h) => `<th>${inlineMarkdown(h)}</th>`).join("")}</tr></thead>`,
			);
			output.push("<tbody>");
			for (const row of rows) {
				output.push(
					`<tr>${row.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`,
				);
			}
			output.push("</tbody></table>");
			continue;
		}

		// List items: - text
		if (/^- /.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^- /.test(lines[i])) {
				items.push(lines[i].slice(2));
				i++;
			}
			output.push(
				`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`,
			);
			continue;
		}

		// Regular paragraph
		if (line.trim()) {
			output.push(`<p>${inlineMarkdown(line)}</p>`);
		}
		i++;
	}
	return output.join("\n");
}

function qualityNotice(quality: string): string {
	if (quality === "local-structured") {
		return '<div class="notice notice-warning">This report was generated from structured debate metadata. For full context, see the debate transcript.</div>';
	}
	if (quality === "local-degraded") {
		return '<div class="notice notice-error">This report was generated with limited data. Review the full debate transcript for complete analysis.</div>';
	}
	return "";
}

export interface MarkdownReportMeta {
	topic: string;
	roundsCompleted: number;
	date: string;
	participants: { proposer: string; challenger: string; judge?: string };
	generationQuality: "llm-full" | "local-structured" | "local-degraded";
}

/**
 * Render LLM-generated markdown into a complete HTML document.
 * Security: HTML-escape first, then apply markdown substitution.
 */
export function renderMarkdownToHtml(
	markdown: string,
	meta: MarkdownReportMeta,
): string {
	const escaped = escHtml(markdown);

	// Split by ## headings into sections
	const sectionRegex = /^## (.+)$/gm;
	const sections: Array<{ title: string; body: string }> = [];
	const titles: Array<{ title: string; index: number }> = [];
	let match: RegExpExecArray | null;

	while ((match = sectionRegex.exec(escaped)) !== null) {
		titles.push({ title: match[1], index: match.index + match[0].length });
	}

	for (let idx = 0; idx < titles.length; idx++) {
		const endIndex =
			idx + 1 < titles.length
				? escaped.lastIndexOf("## ", titles[idx + 1].index)
				: escaped.length;
		sections.push({
			title: titles[idx].title,
			body: escaped.slice(titles[idx].index, endIndex).trim(),
		});
	}

	if (sections.length === 0) {
		sections.push({ title: "Report", body: escaped });
	}

	const sectionHtml = sections
		.map((s) => {
			const bodyLines = s.body.split("\n").filter((l) => l.trim() !== "");
			return `<div class="card">
      <h2>${inlineMarkdown(s.title)}</h2>
      ${renderBlock(bodyLines)}
    </div>`;
		})
		.join("\n");

	const notice = qualityNotice(meta.generationQuality);

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crossfire Debate Report: ${escHtml(meta.topic)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6; color: #333; background: #f5f5f5; padding: 2rem 1rem;
    }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 8px; }
    h1 { color: #1a1a1a; margin-bottom: 0.5rem; font-size: 2rem; }
    h2 { color: #2a2a2a; margin-top: 1rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e0e0e0; font-size: 1.5rem; }
    .meta { color: #666; margin-bottom: 1rem; font-size: 0.95rem; }
    .card { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1.25rem; margin-bottom: 1rem; }
    .notice { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.95rem; }
    .notice-warning { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }
    .notice-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    p { margin-bottom: 0.5rem; }
    ul { margin-left: 1.5rem; margin-top: 0.5rem; margin-bottom: 0.5rem; }
    li { margin-bottom: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; margin-bottom: 0.5rem; }
    th, td { text-align: left; padding: 0.75rem; border: 1px solid #ddd; }
    th { background: #f0f0f0; font-weight: 600; }
    code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { font-weight: 600; }
    @media (max-width: 768px) { body { padding: 1rem 0.5rem; } .container { padding: 1.5rem; } h1 { font-size: 1.5rem; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Crossfire Debate Report</h1>
    <div class="meta">
      <strong>Topic:</strong> ${escHtml(meta.topic)}<br>
      <strong>Rounds:</strong> ${meta.roundsCompleted}<br>
      <strong>Date:</strong> ${escHtml(meta.date)}<br>
      <strong>Participants:</strong> Proposer: ${escHtml(meta.participants.proposer)}, Challenger: ${escHtml(meta.participants.challenger)}${meta.participants.judge ? `, Judge: ${escHtml(meta.participants.judge)}` : ""}
    </div>
    ${notice}
    ${sectionHtml}
  </div>
</body>
</html>`;
}
