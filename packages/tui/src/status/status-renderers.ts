import type {
	PolicyTranslationSummary,
	ResolvedPolicy,
} from "@crossfire/adapter-core";
import type {
	StatusPolicyView,
	StatusToolsView,
} from "./status-view-models.js";

function renderPolicySummary(policy: ResolvedPolicy): string[] {
	const lines: string[] = [];
	const caps = policy.capabilities;
	if (caps) {
		const entries = Object.entries(caps).filter(([, v]) => v !== undefined);
		if (entries.length > 0) {
			lines.push("  Capabilities:");
			for (const [k, v] of entries) {
				lines.push(`    ${k}: ${String(v)}`);
			}
		}
	}
	const interaction = policy.interaction;
	if (interaction) {
		const entries = Object.entries(interaction).filter(
			([, v]) => v !== undefined,
		);
		if (entries.length > 0) {
			lines.push("  Interaction:");
			for (const [k, v] of entries) {
				lines.push(`    ${k}: ${JSON.stringify(v)}`);
			}
		}
	}
	if (policy.evidence) {
		lines.push("  Evidence:");
		lines.push(`    bar: ${policy.evidence.bar}`);
	}
	return lines;
}

function renderTranslationSummary(
	label: string,
	summary: PolicyTranslationSummary,
): string[] {
	const lines = [`  ${label}:`];
	lines.push(`    adapter: ${summary.adapter}`);
	lines.push(`    nativeSummary: ${JSON.stringify(summary.nativeSummary)}`);
	lines.push(`    exactFields: ${summary.exactFields.join(", ") || "(none)"}`);
	lines.push(
		`    approximateFields: ${summary.approximateFields.join(", ") || "(none)"}`,
	);
	lines.push(
		`    unsupportedFields: ${summary.unsupportedFields.join(", ") || "(none)"}`,
	);
	return lines;
}

export function renderStatusPolicy(views: StatusPolicyView[]): string {
	if (views.length === 0) {
		return "Policy state not yet available.";
	}

	const lines: string[] = [];
	for (const view of views) {
		lines.push(`\n=== ${view.role} (${view.adapter}) model=${view.model} ===`);
		lines.push(
			`  Preset: ${view.baseline.preset.value} (${view.baseline.preset.source})`,
		);

		lines.push(...renderPolicySummary(view.baseline.policy));

		if (view.baseline.template) {
			const base = view.baseline.template.basePreset
				? ` (basePreset: ${view.baseline.template.basePreset})`
				: "";
			lines.push(`  Template: ${view.baseline.template.name}${base}`);
		}

		if (view.baseline.evidenceSource) {
			lines.push(`  Evidence Source: ${view.baseline.evidenceSource}`);
		}

		if (view.baseline.clamps.length > 0) {
			lines.push("  Clamps:");
			for (const c of view.baseline.clamps) {
				lines.push(`    ${c.field}: ${c.before} → ${c.after} (${c.reason})`);
			}
		}

		lines.push(
			...renderTranslationSummary(
				"Translation",
				view.baseline.translationSummary,
			),
		);

		if (view.baseline.warnings.length > 0) {
			lines.push("  Warnings:");
			for (const w of view.baseline.warnings) {
				lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
			}
		}

		if (view.override) {
			lines.push(
				`  Override: turnId=${view.override.turnId} preset=${view.override.preset}`,
			);
			lines.push(...renderPolicySummary(view.override.policy));
			lines.push(
				...renderTranslationSummary(
					"Override Translation",
					view.override.translationSummary,
				),
			);
			if (view.override.warnings.length > 0) {
				lines.push("  Override Warnings:");
				for (const w of view.override.warnings) {
					lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
				}
			}
		}
	}
	return lines.join("\n");
}

export function renderStatusTools(views: StatusToolsView[]): string {
	if (views.length === 0) {
		return "Tool state not yet available.";
	}

	const lines: string[] = [
		"(Best-effort observation — not an execution guarantee)",
	];
	for (const view of views) {
		lines.push(`\n=== ${view.role} (${view.adapter}) ===`);
		lines.push(`  Source: ${view.source}`);
		lines.push(`  Completeness: ${view.completeness}`);

		if (view.capabilityEffects.length > 0) {
			lines.push("  Capability Effects:");
			for (const e of view.capabilityEffects) {
				lines.push(`    [${e.status}] ${e.field}: ${e.details ?? ""}`);
			}
		}

		if (view.toolView.length > 0) {
			lines.push("  Tools:");
			for (const t of view.toolView) {
				const icon = t.status === "allowed" ? "✓" : "✗";
				const suffix = t.capabilityField ? ` (${t.capabilityField})` : "";
				lines.push(
					`    ${icon} ${t.name} [${t.source}] ${t.status} — ${t.reason}${suffix}`,
				);
			}
		}

		if (view.warnings.length > 0) {
			lines.push("  Warnings:");
			for (const w of view.warnings) {
				lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
			}
		}
	}
	return lines.join("\n");
}
