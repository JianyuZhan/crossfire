import { z } from "zod";

const McpServerSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
});

export const ProfileSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	agent: z.enum(["claude_code", "codex", "gemini_cli"]),
	model: z.string().optional(),
	prompt_template_family: z.enum(["auto", "general", "code"]).optional(),
	inherit_global_config: z.boolean().default(true),
	mcp_servers: z.record(McpServerSchema).default({}),
});

export interface ProfileConfig extends z.infer<typeof ProfileSchema> {
	systemPrompt: string;
	filePath: string;
}
