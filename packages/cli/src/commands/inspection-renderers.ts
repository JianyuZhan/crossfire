// packages/cli/src/commands/inspection-renderers.ts
import type { RoleInspectionContext } from "./inspection-context.js";

export function renderPolicyText(contexts: RoleInspectionContext[]): string {
	const lines: string[] = [];
	for (const ctx of contexts) {
		if (ctx.error) {
			lines.push(`\n[${ctx.role}] ERROR: ${ctx.error.message}`);
			continue;
		}
		lines.push(`\n=== ${ctx.role} (${ctx.adapter}) ===`);
		lines.push(`  Preset: ${ctx.preset.value} (${ctx.preset.source})`);
		lines.push(`  Model: ${ctx.model ?? "(default)"}`);
		if (ctx.clamps.length > 0) {
			lines.push("  Clamps:");
			for (const c of ctx.clamps) {
				lines.push(`    ${c.field}: ${c.before} → ${c.after} (${c.reason})`);
			}
		}
		if (ctx.observation.warnings.length > 0) {
			lines.push("  Warnings:");
			for (const w of ctx.observation.warnings) {
				lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
			}
		}
		const t = ctx.observation.translation;
		lines.push(`  Translation: ${JSON.stringify(t.nativeSummary)}`);
	}
	return lines.join("\n");
}

export function renderToolsText(contexts: RoleInspectionContext[]): string {
	const lines: string[] = [];
	for (const ctx of contexts) {
		if (ctx.error) {
			lines.push(`\n[${ctx.role}] ERROR: ${ctx.error.message}`);
			continue;
		}
		lines.push(`\n=== ${ctx.role} (${ctx.adapter}) ===`);
		lines.push(`  Preset: ${ctx.preset.value} (${ctx.preset.source})`);
		lines.push(`  Completeness: ${ctx.observation.completeness}`);
		if (ctx.observation.capabilityEffects.length > 0) {
			lines.push("  Capability Effects:");
			for (const e of ctx.observation.capabilityEffects) {
				lines.push(`    [${e.status}] ${e.field}: ${e.details ?? ""}`);
			}
		}
		if (ctx.observation.toolView.length > 0) {
			lines.push("  Tools:");
			for (const t of ctx.observation.toolView) {
				const suffix = t.capabilityField ? ` (${t.capabilityField})` : "";
				lines.push(
					`    ${t.status === "allowed" ? "✓" : "✗"} ${t.name} [${t.source}] ${t.status} — ${t.reason}${suffix}`,
				);
			}
		}
		if (ctx.observation.warnings.length > 0) {
			lines.push("  Warnings:");
			for (const w of ctx.observation.warnings) {
				lines.push(`    [${w.reason}] ${w.field}: ${w.message}`);
			}
		}
	}
	return lines.join("\n");
}
