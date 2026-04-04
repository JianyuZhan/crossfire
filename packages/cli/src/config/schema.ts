import { z } from "zod";

const PolicyPresetSchema = z.enum(["research", "guarded", "dangerous", "plan"]);

const McpServerConfigSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
});

const ProviderBindingConfigSchema = z.object({
	name: z.string(),
	adapter: z.enum(["claude", "codex", "gemini"]),
	model: z.string().optional(),
	providerOptions: z.record(z.unknown()).optional(),
	mcpServers: z.array(z.string()).optional(),
});

const RoleProfileConfigSchema = z.object({
	binding: z.string(),
	model: z.string().optional(),
	preset: PolicyPresetSchema.optional(),
	systemPrompt: z.string().optional(),
});

export const CrossfireConfigSchema = z.object({
	mcpServers: z.record(McpServerConfigSchema).optional(),
	providerBindings: z.array(ProviderBindingConfigSchema),
	roles: z.object({
		proposer: RoleProfileConfigSchema,
		challenger: RoleProfileConfigSchema,
		judge: RoleProfileConfigSchema.optional(),
	}),
});

export type CrossfireConfig = z.infer<typeof CrossfireConfigSchema>;
export type ProviderBindingConfig = z.infer<typeof ProviderBindingConfigSchema>;
export type RoleProfileConfig = z.infer<typeof RoleProfileConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
