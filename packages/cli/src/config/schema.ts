import { z } from "zod";

const PolicyPresetSchema = z.enum(["research", "guarded", "dangerous", "plan"]);

const EvidenceBarSchema = z.enum(["low", "medium", "high"]);

const ApprovalLevelSchema = z.enum([
	"always",
	"on-risk",
	"on-failure",
	"never",
]);

const McpServerConfigSchema = z
	.object({
		command: z.string(),
		args: z.array(z.string()).optional(),
		env: z.record(z.string()).optional(),
	})
	.strict();

const ProviderBindingConfigSchema = z
	.object({
		name: z.string(),
		adapter: z.enum(["claude", "codex", "gemini"]),
		model: z.string().optional(),
		providerOptions: z.record(z.unknown()).optional(),
		mcpServers: z.array(z.string()).optional(),
	})
	.strict();

const PolicyTemplateOverridesSchema = z
	.object({
		evidence: z
			.object({
				bar: EvidenceBarSchema,
			})
			.strict()
			.optional(),
		interaction: z
			.object({
				approval: ApprovalLevelSchema.optional(),
				limits: z
					.object({
						maxTurns: z.number().optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const PolicyTemplateConfigSchema = z
	.object({
		name: z.string(),
		basePreset: PolicyPresetSchema.optional(),
		overrides: PolicyTemplateOverridesSchema.optional(),
	})
	.strict();

const RoleProfileConfigSchema = z
	.object({
		binding: z.string(),
		model: z.string().optional(),
		preset: PolicyPresetSchema.optional(),
		systemPrompt: z.string().optional(),
		systemPromptFile: z.string().optional(),
		template: z.string().optional(),
		evidence: z
			.object({
				bar: EvidenceBarSchema,
			})
			.strict()
			.optional(),
	})
	.strict();

export const CrossfireConfigSchema = z
	.object({
		mcpServers: z.record(McpServerConfigSchema).optional(),
		providerBindings: z.array(ProviderBindingConfigSchema),
		templates: z.array(PolicyTemplateConfigSchema).optional(),
		roles: z
			.object({
				proposer: RoleProfileConfigSchema,
				challenger: RoleProfileConfigSchema,
				judge: RoleProfileConfigSchema.optional(),
			})
			.strict(),
	})
	.strict()
	.superRefine((config, ctx) => {
		// Validate unique template names
		if (config.templates) {
			const names = new Set<string>();
			for (const [index, template] of config.templates.entries()) {
				if (names.has(template.name)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Duplicate template name: ${template.name}`,
						path: ["templates", index, "name"],
					});
				}
				names.add(template.name);
			}
		}

		for (const [roleName, role] of Object.entries(config.roles)) {
			if (!role) continue;
			if (role.systemPrompt && role.systemPromptFile) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Use either "systemPrompt" or "systemPromptFile", not both',
					path: ["roles", roleName, "systemPromptFile"],
				});
			}
		}
	});

export type CrossfireConfig = z.infer<typeof CrossfireConfigSchema>;
export type ProviderBindingConfig = z.infer<typeof ProviderBindingConfigSchema>;
export type RoleProfileConfig = z.infer<typeof RoleProfileConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type PolicyTemplateConfig = z.infer<typeof PolicyTemplateConfigSchema>;
