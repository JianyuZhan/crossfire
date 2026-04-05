import { describe, expect, it } from "vitest";
import {
	expectNoWarnings,
	expectWarning,
	expectWarningWithMessage,
	makeCompileInput,
	makeResolvedPolicy,
	makeWarning,
	normalizeWarnings,
} from "../../src/testing/index.js";

describe("makeCompileInput", () => {
	it("returns guarded+proposer by default", () => {
		const input = makeCompileInput();
		expect(input.preset).toBe("guarded");
		expect(input.role).toBe("proposer");
	});

	it("accepts overrides", () => {
		const input = makeCompileInput({ preset: "research", role: "judge" });
		expect(input.preset).toBe("research");
		expect(input.role).toBe("judge");
	});
});

describe("makeResolvedPolicy", () => {
	it("returns a compiled policy for guarded+proposer by default", () => {
		const policy = makeResolvedPolicy();
		expect(policy.preset).toBe("guarded");
		expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
		expect(policy.capabilities.filesystem).toBe("write");
	});

	it("accepts preset and role overrides", () => {
		const policy = makeResolvedPolicy({ preset: "research", role: "judge" });
		expect(policy.preset).toBe("research");
		expect(policy.roleContract.semantics.exploration).toBe("forbidden");
		// Judge ceiling clamps research capabilities
		expect(policy.capabilities.shell).toBe("off");
	});
});

describe("makeWarning", () => {
	it("returns a default warning", () => {
		const w = makeWarning();
		expect(w.field).toBe("test.field");
		expect(w.adapter).toBe("claude");
		expect(w.reason).toBe("approximate");
		expect(w.message).toBe("Test warning");
	});

	it("accepts overrides", () => {
		const w = makeWarning({
			field: "interaction.approval",
			adapter: "codex",
			reason: "not_implemented",
		});
		expect(w.field).toBe("interaction.approval");
		expect(w.adapter).toBe("codex");
		expect(w.reason).toBe("not_implemented");
	});
});

describe("expectWarning", () => {
	it("passes when matching warning exists", () => {
		const warnings = [
			makeWarning({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			}),
		];
		expect(() =>
			expectWarning(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			}),
		).not.toThrow();
	});

	it("throws when no matching warning exists", () => {
		const warnings = [
			makeWarning({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
			}),
		];
		expect(() =>
			expectWarning(warnings, {
				field: "capabilities.shell",
				adapter: "claude",
				reason: "not_implemented",
			}),
		).toThrow(/not found/);
	});
});

describe("expectWarningWithMessage", () => {
	it("passes when matching warning with message substring exists", () => {
		const warnings = [
			makeWarning({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "Claude has no per-tool-must-approve mode; mapped to default",
			}),
		];
		expect(() =>
			expectWarningWithMessage(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				messageContains: "per-tool-must-approve",
			}),
		).not.toThrow();
	});

	it("throws when message does not contain substring", () => {
		const warnings = [
			makeWarning({
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				message: "some message",
			}),
		];
		expect(() =>
			expectWarningWithMessage(warnings, {
				field: "interaction.approval",
				adapter: "claude",
				reason: "approximate",
				messageContains: "nonexistent",
			}),
		).toThrow(/not found/);
	});
});

describe("expectNoWarnings", () => {
	it("passes for empty warnings", () => {
		expect(() => expectNoWarnings([])).not.toThrow();
	});

	it("throws for non-empty warnings", () => {
		expect(() => expectNoWarnings([makeWarning()])).toThrow(
			/Expected no warnings/,
		);
	});
});

describe("normalizeWarnings", () => {
	it("sorts by field, then reason, then adapter", () => {
		const warnings = [
			makeWarning({
				field: "z.field",
				adapter: "claude",
				reason: "approximate",
			}),
			makeWarning({
				field: "a.field",
				adapter: "gemini",
				reason: "unsupported",
			}),
			makeWarning({
				field: "a.field",
				adapter: "codex",
				reason: "unsupported",
			}),
			makeWarning({
				field: "a.field",
				adapter: "claude",
				reason: "not_implemented",
			}),
		];
		const sorted = normalizeWarnings(warnings);
		expect(sorted[0].field).toBe("a.field");
		expect(sorted[0].reason).toBe("not_implemented");
		expect(sorted[1].adapter).toBe("codex");
		expect(sorted[2].adapter).toBe("gemini");
		expect(sorted[3].field).toBe("z.field");
	});
});
