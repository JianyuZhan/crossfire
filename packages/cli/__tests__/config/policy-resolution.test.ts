import { describe, expect, it } from "vitest";
import {
	DEFAULT_ROLE_PRESETS,
	resolveRolePreset,
} from "../../src/config/policy-resolution.js";

describe("DEFAULT_ROLE_PRESETS", () => {
	it("proposer defaults to guarded", () => {
		expect(DEFAULT_ROLE_PRESETS.proposer).toBe("guarded");
	});
	it("challenger defaults to guarded", () => {
		expect(DEFAULT_ROLE_PRESETS.challenger).toBe("guarded");
	});
	it("judge defaults to plan", () => {
		expect(DEFAULT_ROLE_PRESETS.judge).toBe("plan");
	});
});

describe("resolveRolePreset", () => {
	it("CLI role-specific preset wins over everything", () => {
		const result = resolveRolePreset({
			role: "proposer",
			configPreset: "research",
			cliGlobalPreset: "dangerous",
			cliRolePreset: "plan",
		});
		expect(result).toEqual({ preset: "plan", source: "cli-role" });
	});

	it("CLI global preset wins over config and default", () => {
		const result = resolveRolePreset({
			role: "proposer",
			configPreset: "research",
			cliGlobalPreset: "dangerous",
		});
		expect(result).toEqual({ preset: "dangerous", source: "cli-global" });
	});

	it("config preset wins over default", () => {
		const result = resolveRolePreset({
			role: "proposer",
			configPreset: "research",
		});
		expect(result).toEqual({ preset: "research", source: "config" });
	});

	it("falls back to role default when nothing specified", () => {
		const result = resolveRolePreset({ role: "proposer" });
		expect(result).toEqual({ preset: "guarded", source: "role-default" });
	});

	it("judge defaults to plan", () => {
		const result = resolveRolePreset({ role: "judge" });
		expect(result).toEqual({ preset: "plan", source: "role-default" });
	});
});
