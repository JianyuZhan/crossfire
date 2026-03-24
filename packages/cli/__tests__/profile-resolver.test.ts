import { describe, expect, it } from "vitest";
import {
	resolveAdapterType,
	resolveModel,
	resolveRoles,
} from "../src/profile/resolver.js";
import type { ProfileConfig } from "../src/profile/schema.js";

const makeProfile = (
	overrides: Partial<ProfileConfig> = {},
): ProfileConfig => ({
	name: "test",
	agent: "claude_code",
	inherit_global_config: true,
	mcp_servers: {},
	systemPrompt: "test prompt",
	filePath: "/test.md",
	...overrides,
});

describe("resolveModel", () => {
	it("CLI override takes priority over profile model", () => {
		expect(
			resolveModel("cli-model", makeProfile({ model: "profile-model" })),
		).toBe("cli-model");
	});
	it("falls back to profile model when no CLI override", () => {
		expect(
			resolveModel(undefined, makeProfile({ model: "profile-model" })),
		).toBe("profile-model");
	});
	it("returns undefined when no model specified", () => {
		expect(
			resolveModel(undefined, makeProfile({ model: undefined })),
		).toBeUndefined();
	});
});

describe("resolveAdapterType", () => {
	it("maps claude_code to claude", () => {
		expect(resolveAdapterType("claude_code")).toBe("claude");
	});
	it("maps codex to codex", () => {
		expect(resolveAdapterType("codex")).toBe("codex");
	});
	it("maps gemini_cli to gemini", () => {
		expect(resolveAdapterType("gemini_cli")).toBe("gemini");
	});
});

describe("resolveRoles", () => {
	it("handles judge: none", () => {
		const result = resolveRoles({
			proposer: { profile: makeProfile(), cliModel: undefined },
			challenger: {
				profile: makeProfile({ agent: "codex" }),
				cliModel: undefined,
			},
			judge: "none",
		});
		expect(result.judge).toBeUndefined();
	});
	it("resolves all three roles", () => {
		const result = resolveRoles({
			proposer: { profile: makeProfile(), cliModel: "override" },
			challenger: {
				profile: makeProfile({ agent: "codex" }),
				cliModel: undefined,
			},
			judge: {
				profile: makeProfile({ agent: "gemini_cli" }),
				cliModel: undefined,
			},
		});
		expect(result.proposer.model).toBe("override");
		expect(result.challenger).toBeDefined();
		expect(result.judge).toBeDefined();
	});
});
