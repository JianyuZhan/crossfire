import { describe, expect, it } from "vitest";
import { compilePolicyWithDiagnostics } from "../../src/policy/compiler.js";
import { makeCompileInput } from "../../src/testing/index.js";

describe("compilePolicyWithDiagnostics", () => {
	it("returns empty clamps when no ceiling applies", () => {
		const result = compilePolicyWithDiagnostics(
			makeCompileInput({ preset: "guarded", role: "proposer" }),
		);
		expect(result.clamps).toEqual([]);
		expect(result.policy.preset).toBe("guarded");
	});

	it("records clamp when judge ceiling lowers dangerous capabilities", () => {
		const result = compilePolicyWithDiagnostics(
			makeCompileInput({ preset: "dangerous", role: "judge" }),
		);
		expect(result.clamps).toContainEqual({
			field: "capabilities.filesystem",
			before: "write",
			after: "read",
			reason: "role_ceiling",
		});
		expect(result.clamps).toContainEqual({
			field: "capabilities.network",
			before: "full",
			after: "search",
			reason: "role_ceiling",
		});
		expect(result.clamps).toContainEqual({
			field: "capabilities.shell",
			before: "exec",
			after: "off",
			reason: "role_ceiling",
		});
		expect(result.clamps).toContainEqual({
			field: "capabilities.subagents",
			before: "on",
			after: "off",
			reason: "role_ceiling",
		});
		expect(result.clamps).toHaveLength(4);
	});

	it("does not record clamp when ceiling matches preset value", () => {
		// research preset has filesystem=read, judge ceiling is also read
		const result = compilePolicyWithDiagnostics(
			makeCompileInput({ preset: "research", role: "judge" }),
		);
		expect(result.clamps).toEqual([]);
	});

	it("policy output matches compilePolicy output", async () => {
		const { compilePolicy } = await import("../../src/policy/compiler.js");
		const input = makeCompileInput({ preset: "dangerous", role: "judge" });
		const diag = compilePolicyWithDiagnostics(input);
		const plain = compilePolicy(input);
		expect(diag.policy).toEqual(plain);
	});

	it("clamp field uses structured path format", () => {
		const result = compilePolicyWithDiagnostics(
			makeCompileInput({ preset: "dangerous", role: "judge" }),
		);
		for (const clamp of result.clamps) {
			expect(clamp.field).toMatch(/^capabilities\./);
		}
	});
});
