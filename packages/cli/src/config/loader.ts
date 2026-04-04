import { existsSync, readFileSync } from "node:fs";
import { type CrossfireConfig, CrossfireConfigSchema } from "./schema.js";

export function loadConfig(filePath: string): CrossfireConfig {
	if (!existsSync(filePath)) {
		throw new Error(`Config file not found: ${filePath}`);
	}
	const raw = readFileSync(filePath, "utf-8");
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error(`Config parse error (${filePath}): expected valid JSON`);
	}
	const result = CrossfireConfigSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Config validation failed (${filePath}): ${issues}`);
	}
	const config = result.data;
	validateReferences(config);
	return config;
}

function validateReferences(config: CrossfireConfig): void {
	const bindingNames = new Set(config.providerBindings.map((b) => b.name));
	const mcpNames = new Set(Object.keys(config.mcpServers ?? {}));

	for (const [roleName, roleConfig] of Object.entries(config.roles)) {
		if (!roleConfig) continue;
		if (!bindingNames.has(roleConfig.binding)) {
			throw new Error(
				`Role "${roleName}" references binding "${roleConfig.binding}" which does not exist. ` +
					`Available bindings: ${[...bindingNames].join(", ")}`,
			);
		}
	}
	for (const binding of config.providerBindings) {
		for (const serverName of binding.mcpServers ?? []) {
			if (!mcpNames.has(serverName)) {
				throw new Error(
					`Provider binding "${binding.name}" references MCP server "${serverName}" which does not exist. ` +
						`Available servers: ${[...mcpNames].join(", ")}`,
				);
			}
		}
	}
}
