import { describe, expect, it } from "vitest";
import { ResumeManager } from "../src/resume-manager.js";

describe("ResumeManager", () => {
	it("buildArgs first turn: no --resume", () => {
		const rm = new ResumeManager();
		const args = rm.buildArgs({ prompt: "hello", sessionId: undefined });
		expect(args).toContain("-p");
		expect(args).toContain("hello");
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		expect(args).not.toContain("--resume");
	});

	it("buildArgs subsequent turn: includes --resume", () => {
		const rm = new ResumeManager();
		const args = rm.buildArgs({ prompt: "next", sessionId: "sid-123" });
		expect(args).toContain("--resume");
		expect(args).toContain("sid-123");
		expect(args).toContain("-p");
		expect(args).toContain("next");
	});

	it("buildArgs force stateless: no --resume even with sessionId", () => {
		const rm = new ResumeManager();
		const args = rm.buildArgs({
			prompt: "retry",
			sessionId: "sid-123",
			forceStateless: true,
		});
		expect(args).not.toContain("--resume");
		expect(args).toContain("-p");
	});

	it("buildArgs always includes --output-format stream-json", () => {
		const rm = new ResumeManager();
		const args1 = rm.buildArgs({ prompt: "a" });
		const args2 = rm.buildArgs({ prompt: "b", sessionId: "s1" });
		expect(args1).toContain("--output-format");
		expect(args2).toContain("stream-json");
	});

	it("validateInit: valid with matching sessionId", () => {
		const rm = new ResumeManager();
		const result = rm.validateInit({ session_id: "sid-123" }, "sid-123");
		expect(result.valid).toBe(true);
	});

	it("validateInit: valid first turn (no expected sessionId)", () => {
		const rm = new ResumeManager();
		const result = rm.validateInit({ session_id: "new-sid" }, undefined);
		expect(result.valid).toBe(true);
	});

	it("validateInit: mismatched sessionId", () => {
		const rm = new ResumeManager();
		const result = rm.validateInit({ session_id: "sid-999" }, "sid-123");
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("mismatch");
	});

	it("validateInit: missing session_id", () => {
		const rm = new ResumeManager();
		const result = rm.validateInit({}, undefined);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("missing");
	});

	it("validateInit: null session_id", () => {
		const rm = new ResumeManager();
		const result = rm.validateInit({ session_id: null }, undefined);
		expect(result.valid).toBe(false);
	});
});
