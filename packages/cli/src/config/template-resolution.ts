import type { PolicyTemplateConfig } from "./schema.js";

export function resolveTemplate(
	name: string,
	templates: PolicyTemplateConfig[] | undefined,
): PolicyTemplateConfig | undefined {
	if (!templates) return undefined;
	return templates.find((t) => t.name === name);
}
