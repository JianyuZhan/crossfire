import { describe, expect, it } from "vitest";
import { evaluateClarification } from "../../src/director/clarification-policy.js";

describe("evaluateClarification", () => {
	it("accepts missing-fact type as clarification", () => {
		const result = evaluateClarification({
			type: "clarification",
			question: "What is the budget?",
		});
		expect(result.allowed).toBe(true);
		expect(result.category).toBe("missing-fact");
	});

	it("accepts arbitration type as user-preference", () => {
		const result = evaluateClarification({
			type: "arbitration",
			question: "Should we prioritize speed or cost?",
		});
		expect(result.allowed).toBe(true);
		expect(result.category).toBe("user-preference");
	});

	it("rejects empty question", () => {
		const result = evaluateClarification({
			type: "clarification",
			question: "",
		});
		expect(result.allowed).toBe(false);
	});
});
