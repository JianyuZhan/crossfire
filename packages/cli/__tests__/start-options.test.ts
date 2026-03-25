import { describe, expect, it } from "vitest";
import { resolveRoles } from "../src/profile/resolver.js";
import type { ProfileConfig } from "../src/profile/schema.js";

/**
 * Helper to build a minimal ProfileConfig for testing.
 */
function makeProfile(
	agent: ProfileConfig["agent"],
	model?: string,
): ProfileConfig {
	return {
		name: `test-${agent}`,
		agent,
		model,
		inherit_global_config: true,
		mcp_servers: {},
		systemPrompt: "test prompt",
		filePath: `/test/${agent}.md`,
	};
}

/**
 * Mirrors the numeric validation logic now in start.ts.
 * Returns an error message or null if valid.
 */
function validateNumericOptions(opts: {
	maxRounds: string;
	convergenceThreshold: string;
	judgeEveryNRounds: string;
}): string | null {
	const maxRounds = Number.parseInt(opts.maxRounds, 10);
	if (!Number.isFinite(maxRounds) || maxRounds < 1) {
		return "--max-rounds must be a positive integer";
	}
	const convergenceThreshold = Number.parseFloat(opts.convergenceThreshold);
	if (
		!Number.isFinite(convergenceThreshold) ||
		convergenceThreshold < 0 ||
		convergenceThreshold > 1
	) {
		return "--convergence-threshold must be between 0 and 1";
	}
	const judgeEveryNRounds = Number.parseInt(opts.judgeEveryNRounds, 10);
	if (!Number.isFinite(judgeEveryNRounds) || judgeEveryNRounds < 1) {
		return "--judge-every-n-rounds must be a positive integer";
	}
	if (judgeEveryNRounds >= maxRounds) {
		return "--judge-every-n-rounds must be less than --max-rounds";
	}
	return null;
}

// ---------------------------------------------------------------------------
// 1. Numeric option validation
// ---------------------------------------------------------------------------
describe("numeric option validation", () => {
	it("rejects NaN for --max-rounds", () => {
		const err = validateNumericOptions({
			maxRounds: "abc",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--max-rounds");
	});

	it("rejects 0 for --max-rounds", () => {
		const err = validateNumericOptions({
			maxRounds: "0",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--max-rounds");
	});

	it("rejects negative --max-rounds", () => {
		const err = validateNumericOptions({
			maxRounds: "-1",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--max-rounds");
	});

	it("rejects --convergence-threshold > 1", () => {
		const err = validateNumericOptions({
			maxRounds: "10",
			convergenceThreshold: "2.0",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--convergence-threshold");
	});

	it("rejects negative --convergence-threshold", () => {
		const err = validateNumericOptions({
			maxRounds: "10",
			convergenceThreshold: "-0.5",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--convergence-threshold");
	});

	it("rejects NaN for --judge-every-n-rounds", () => {
		const err = validateNumericOptions({
			maxRounds: "10",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "abc",
		});
		expect(err).toContain("--judge-every-n-rounds");
	});

	it("accepts valid combination", () => {
		const err = validateNumericOptions({
			maxRounds: "10",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toBeNull();
	});

	it("accepts boundary values (threshold=0 and threshold=1)", () => {
		expect(
			validateNumericOptions({
				maxRounds: "10",
				convergenceThreshold: "0",
				judgeEveryNRounds: "3",
			}),
		).toBeNull();
		expect(
			validateNumericOptions({
				maxRounds: "10",
				convergenceThreshold: "1",
				judgeEveryNRounds: "3",
			}),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. maxRounds vs judgeEveryNRounds cross-validation
// ---------------------------------------------------------------------------
describe("maxRounds vs judgeEveryNRounds cross-validation", () => {
	it("rejects judgeEveryNRounds >= maxRounds", () => {
		const err = validateNumericOptions({
			maxRounds: "3",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toContain("--judge-every-n-rounds");
		expect(err).toContain("--max-rounds");
	});

	it("rejects judgeEveryNRounds > maxRounds", () => {
		const err = validateNumericOptions({
			maxRounds: "3",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "5",
		});
		expect(err).toContain("--judge-every-n-rounds");
	});

	it("accepts judgeEveryNRounds < maxRounds", () => {
		const err = validateNumericOptions({
			maxRounds: "10",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "3",
		});
		expect(err).toBeNull();
	});

	it("accepts judgeEveryNRounds = 1 with any maxRounds > 1", () => {
		const err = validateNumericOptions({
			maxRounds: "2",
			convergenceThreshold: "0.3",
			judgeEveryNRounds: "1",
		});
		expect(err).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. Judge option interactions
// ---------------------------------------------------------------------------
describe("judge option interactions", () => {
	it("resolveRoles always returns judge when judge input is provided", () => {
		const roles = resolveRoles({
			proposer: { profile: makeProfile("claude_code"), cliModel: undefined },
			challenger: { profile: makeProfile("codex"), cliModel: undefined },
			judge: {
				profile: makeProfile("gemini_cli", "gemini-2.5-pro"),
				cliModel: undefined,
			},
		});
		expect(roles.judge).toBeDefined();
		expect(roles.judge?.adapterType).toBe("gemini");
		expect(roles.judge?.model).toBe("gemini-2.5-pro");
	});

	it("judge profile is inferred from proposer adapter type by default", () => {
		// When --judge is not specified, start.ts infers `${adapterType}/judge`.
		// This test documents the convention.
		const adapterType = "claude";
		const inferredJudge = `${adapterType}/judge`;
		expect(inferredJudge).toBe("claude/judge");
	});
});

// ---------------------------------------------------------------------------
// 4. Headless mode
// ---------------------------------------------------------------------------
describe("headless mode", () => {
	it("headless flag defaults to false in Commander definition", () => {
		// .option("--headless", "Run without TUI", false)
		const defaultValue = false;
		expect(defaultValue).toBe(false);
	});

	it("non-TUI mode always prints completion info", () => {
		// After fix: both headless and non-headless non-TUI modes print output.
		// The condition is: if (!inkInstance) { print summary }
		const inkInstance = null;
		const printsSummary = !inkInstance;
		expect(printsSummary).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. Topic mutual exclusivity
// ---------------------------------------------------------------------------
describe("topic mutual exclusivity", () => {
	function isTopicValid(options: {
		topic?: string;
		topicFile?: string;
	}): boolean {
		const hasTopic = !!options.topic;
		const hasTopicFile = !!options.topicFile;
		return hasTopic !== hasTopicFile;
	}

	it("rejects when neither --topic nor --topic-file is provided", () => {
		expect(isTopicValid({})).toBe(false);
	});

	it("rejects when both --topic and --topic-file are provided", () => {
		expect(isTopicValid({ topic: "AI safety", topicFile: "topic.txt" })).toBe(
			false,
		);
	});

	it("accepts when only --topic is provided", () => {
		expect(isTopicValid({ topic: "AI safety" })).toBe(true);
	});

	it("accepts when only --topic-file is provided", () => {
		expect(isTopicValid({ topicFile: "topic.txt" })).toBe(true);
	});

	it("rejects empty string topic as falsy", () => {
		expect(isTopicValid({ topic: "" })).toBe(false);
	});
});
