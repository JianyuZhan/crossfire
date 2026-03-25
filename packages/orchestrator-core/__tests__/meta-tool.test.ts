import { describe, expect, it } from "vitest";
import { DebateMetaSchema, JudgeVerdictSchema } from "../src/meta-tool.js";

describe("DebateMetaSchema", () => {
	it("accepts valid debate meta", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "agree",
			confidence: 0.8,
			key_points: ["Point A", "Point B"],
			concessions: ["Concession 1"],
			wants_to_conclude: false,
		});
		expect(result.success).toBe(true);
	});

	it("accepts meta without optional fields", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "neutral",
			confidence: 0.5,
			key_points: ["Only point"],
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid stance", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "maybe",
			confidence: 0.5,
			key_points: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects confidence out of range", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "agree",
			confidence: 1.5,
			key_points: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing key_points", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "agree",
			confidence: 0.5,
		});
		expect(result.success).toBe(false);
	});
});

describe("JudgeVerdictSchema", () => {
	it("accepts valid verdict", () => {
		const result = JudgeVerdictSchema.safeParse({
			leading: "proposer",
			score: { proposer: 7, challenger: 5 },
			reasoning: "Proposer had stronger evidence.",
			should_continue: true,
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid leading value", () => {
		const result = JudgeVerdictSchema.safeParse({
			leading: "nobody",
			score: { proposer: 5, challenger: 5 },
			reasoning: "Tie",
			should_continue: false,
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing reasoning", () => {
		const result = JudgeVerdictSchema.safeParse({
			leading: "tie",
			score: { proposer: 5, challenger: 5 },
			should_continue: false,
		});
		expect(result.success).toBe(false);
	});
});

describe("DebateMetaSchema request_intervention", () => {
	it("accepts meta without request_intervention", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "agree",
			confidence: 0.8,
			key_points: ["point"],
			concessions: [],
			wants_to_conclude: false,
		});
		expect(result.success).toBe(true);
	});

	it("accepts meta with request_intervention", () => {
		const result = DebateMetaSchema.safeParse({
			stance: "agree",
			confidence: 0.8,
			key_points: ["point"],
			concessions: [],
			wants_to_conclude: false,
			request_intervention: {
				type: "clarification",
				question: "What budget range?",
			},
		});
		expect(result.success).toBe(true);
		expect(result.data!.request_intervention!.type).toBe("clarification");
	});
});

describe("JudgeVerdictSchema extensions", () => {
	it("accepts verdict with repetition_score", () => {
		const result = JudgeVerdictSchema.safeParse({
			leading: "proposer",
			score: { proposer: 8, challenger: 6 },
			reasoning: "test",
			should_continue: true,
			repetition_score: { proposer: 0.2, challenger: 0.8 },
		});
		expect(result.success).toBe(true);
	});

	it("accepts verdict with clarification_response relay", () => {
		const result = JudgeVerdictSchema.safeParse({
			leading: "tie",
			score: { proposer: 5, challenger: 5 },
			reasoning: "test",
			should_continue: true,
			clarification_response: {
				answered: false,
				relay: "Please clarify budget",
			},
		});
		expect(result.success).toBe(true);
		expect(result.data!.clarification_response!.answered).toBe(false);
	});
});

describe("DebateMetaSchema extended fields", () => {
	it("accepts meta with rebuttals", () => {
		const input = {
			stance: "agree",
			confidence: 0.7,
			key_points: ["p1"],
			rebuttals: [{ target: "opponent said X", response: "but actually Y" }],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts meta with evidence", () => {
		const input = {
			stance: "agree",
			confidence: 0.7,
			key_points: ["p1"],
			evidence: [{ claim: "X is true", source: "benchmark data" }],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts meta with risk_flags", () => {
		const input = {
			stance: "disagree",
			confidence: 0.6,
			key_points: ["p1"],
			risk_flags: [{ risk: "scalability concern", severity: "high" }],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts meta with position_shifts", () => {
		const input = {
			stance: "neutral",
			confidence: 0.5,
			key_points: ["p1"],
			position_shifts: [
				{ from: "strongly agree", to: "agree", reason: "valid counterpoint" },
			],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts meta without any new fields (backward compat)", () => {
		const input = {
			stance: "agree",
			confidence: 0.8,
			key_points: ["p1"],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("rejects invalid severity in risk_flags", () => {
		const input = {
			stance: "agree",
			confidence: 0.7,
			key_points: ["p1"],
			risk_flags: [{ risk: "x", severity: "critical" }],
		};
		const result = DebateMetaSchema.safeParse(input);
		expect(result.success).toBe(false);
	});
});
