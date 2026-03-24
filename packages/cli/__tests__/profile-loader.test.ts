import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadProfile } from "../src/profile/loader.js";
import { ProfileSchema } from "../src/profile/schema.js";

describe("ProfileSchema", () => {
	it("validates a full profile", () => {
		const result = ProfileSchema.safeParse({
			name: "code_reviewer",
			description: "A code reviewer agent",
			agent: "claude_code",
			model: "claude-sonnet-4-20250514",
			inherit_global_config: true,
			mcp_servers: {
				filesystem: {
					command: "npx",
					args: ["-y", "@anthropic-ai/mcp-filesystem"],
				},
			},
		});
		expect(result.success).toBe(true);
	});

	it("validates minimal profile with defaults", () => {
		const result = ProfileSchema.safeParse({ name: "simple", agent: "codex" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.inherit_global_config).toBe(true);
			expect(result.data.mcp_servers).toEqual({});
		}
	});

	it("rejects unknown agent type", () => {
		const result = ProfileSchema.safeParse({
			name: "bad",
			agent: "unknown_agent",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing required fields", () => {
		const result = ProfileSchema.safeParse({ name: "no_agent" });
		expect(result.success).toBe(false);
	});
});

describe("loadProfile", () => {
	let profilesDir: string;
	beforeEach(() => {
		profilesDir = mkdtempSync(join(tmpdir(), "crossfire-profiles-"));
	});

	it("loads valid profile with all fields", () => {
		const content = `---\nname: test_agent\nagent: claude_code\nmodel: claude-sonnet-4-20250514\n---\nYou are a test agent.`;
		writeFileSync(join(profilesDir, "test_agent.md"), content);
		const profile = loadProfile("test_agent", [profilesDir]);
		expect(profile.name).toBe("test_agent");
		expect(profile.agent).toBe("claude_code");
		expect(profile.systemPrompt).toBe("You are a test agent.");
		expect(profile.filePath).toContain("test_agent.md");
	});

	it("loads profile with minimal fields and applies defaults", () => {
		writeFileSync(
			join(profilesDir, "minimal.md"),
			"---\nname: minimal\nagent: codex\n---",
		);
		const profile = loadProfile("minimal", [profilesDir]);
		expect(profile.inherit_global_config).toBe(true);
		expect(profile.mcp_servers).toEqual({});
		expect(profile.systemPrompt).toBe("");
	});

	it("throws on missing file with path hint", () => {
		expect(() => loadProfile("nonexistent", [profilesDir])).toThrow(
			/not found.*searched/i,
		);
	});

	it("throws on Zod validation failure with details", () => {
		writeFileSync(
			join(profilesDir, "bad_agent.md"),
			"---\nname: bad_agent\n---\nSome prompt",
		);
		expect(() => loadProfile("bad_agent", [profilesDir])).toThrow(/agent/i);
	});

	it("extracts system prompt from body", () => {
		writeFileSync(
			join(profilesDir, "prompt_test.md"),
			"---\nname: prompt_test\nagent: gemini_cli\n---\nLine 1\nLine 2",
		);
		const profile = loadProfile("prompt_test", [profilesDir]);
		expect(profile.systemPrompt).toBe("Line 1\nLine 2");
	});
});
