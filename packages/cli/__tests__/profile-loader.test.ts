import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
		const content = JSON.stringify({
			name: "test_agent",
			agent: "claude_code",
			model: "claude-sonnet-4-20250514",
		});
		writeFileSync(join(profilesDir, "test_agent.json"), content);
		const profile = loadProfile("test_agent", [profilesDir]);
		expect(profile.name).toBe("test_agent");
		expect(profile.agent).toBe("claude_code");
		expect(profile.filePath).toContain("test_agent.json");
	});

	it("loads profile with minimal fields and applies defaults", () => {
		writeFileSync(
			join(profilesDir, "minimal.json"),
			JSON.stringify({ name: "minimal", agent: "codex" }),
		);
		const profile = loadProfile("minimal", [profilesDir]);
		expect(profile.inherit_global_config).toBe(true);
		expect(profile.mcp_servers).toEqual({});
	});

	it("throws on missing file with path hint", () => {
		expect(() => loadProfile("nonexistent", [profilesDir])).toThrow(
			/not found.*searched/i,
		);
	});

	it("throws on Zod validation failure with details", () => {
		writeFileSync(
			join(profilesDir, "bad_agent.json"),
			JSON.stringify({ name: "bad_agent" }),
		);
		expect(() => loadProfile("bad_agent", [profilesDir])).toThrow(/agent/i);
	});

	it("rejects invalid JSON", () => {
		writeFileSync(join(profilesDir, "broken.json"), "{ invalid");
		expect(() => loadProfile("broken", [profilesDir])).toThrow(/invalid json/i);
	});

	it("loads the bundled codex challenger profile with the flagship GPT-5.4 model", () => {
		const bundledProfilesDir = resolve(
			__dirname,
			"..",
			"..",
			"..",
			"profiles",
			"providers",
		);
		const profile = loadProfile("codex/challenger", [bundledProfilesDir]);
		expect(profile.model).toBe("gpt-5.4");
	});
});
