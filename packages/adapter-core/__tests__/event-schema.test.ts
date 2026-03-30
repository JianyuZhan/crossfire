import { describe, expect, it } from "vitest";
import { NormalizedEventSchema } from "../src/event-schema.js";

describe("NormalizedEventSchema", () => {
	it("accepts valid session.started", () => {
		const event = {
			kind: "session.started",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			model: "haiku",
			tools: ["bash"],
			providerSessionId: "ps1",
			capabilities: {
				supportsResume: true,
				resumeMode: "protocol-native",
				resumeStability: "stable",
				supportsExternalHistoryInjection: true,
				supportsRawThinking: true,
				supportsReasoningSummary: false,
				supportsPlan: false,
				supportsApproval: true,
				supportsInterrupt: true,
				supportsSubagents: true,
				supportsStreamingDelta: true,
			},
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid message.delta", () => {
		const event = {
			kind: "message.delta",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			turnId: "t1",
			text: "Hello",
			role: "assistant",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid message.final", () => {
		const event = {
			kind: "message.final",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
			text: "Full response",
			role: "assistant",
			stopReason: "end_turn",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid thinking.delta", () => {
		const event = {
			kind: "thinking.delta",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			text: "Thinking...",
			thinkingType: "raw-thinking",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid plan.updated", () => {
		const event = {
			kind: "plan.updated",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			turnId: "t1",
			steps: [
				{ description: "Step 1", status: "completed" },
				{ description: "Step 2", status: "in_progress" },
			],
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid tool.call", () => {
		const event = {
			kind: "tool.call",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
			toolUseId: "tu1",
			toolName: "bash",
			input: { command: "ls" },
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid tool.result", () => {
		const event = {
			kind: "tool.result",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
			toolUseId: "tu1",
			toolName: "bash",
			success: true,
			output: "file.txt",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid approval.request with all approvalTypes", () => {
		for (const approvalType of [
			"tool",
			"command",
			"file-change",
			"user-input",
		]) {
			const event = {
				kind: "approval.request",
				timestamp: Date.now(),
				adapterId: "codex",
				adapterSessionId: "s1",
				requestId: "r1",
				approvalType,
				title: "Approve this",
				payload: {},
			};
			expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
		}
	});

	it("accepts approval.request with approval options", () => {
		const event = {
			kind: "approval.request",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			requestId: "r1",
			approvalType: "tool",
			title: "Allow Bash?",
			payload: { command: "ls" },
			options: [
				{
					id: "allow",
					label: "Allow once",
					kind: "allow",
					isDefault: true,
				},
				{
					id: "allow-session",
					label: "Allow for session",
					kind: "allow-always",
					scope: "session",
				},
			],
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts approval.resolved with provider option selection", () => {
		const event = {
			kind: "approval.resolved",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			requestId: "r1",
			decision: "allow",
			optionId: "acceptWithExecpolicyAmendment",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid turn.completed with usage", () => {
		const event = {
			kind: "turn.completed",
			timestamp: Date.now(),
			adapterId: "gemini",
			adapterSessionId: "s1",
			turnId: "t1",
			status: "completed",
			durationMs: 1200,
			usage: { inputTokens: 100, outputTokens: 50 },
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts turn.completed without usage", () => {
		const event = {
			kind: "turn.completed",
			timestamp: Date.now(),
			adapterId: "gemini",
			adapterSessionId: "s1",
			turnId: "t1",
			status: "failed",
			durationMs: 500,
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid run.error and run.warning", () => {
		const error = {
			kind: "run.error",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			message: "Connection lost",
			recoverable: true,
		};
		const warning = {
			kind: "run.warning",
			timestamp: Date.now(),
			adapterId: "gemini",
			adapterSessionId: "s1",
			message: "Fallback triggered",
		};
		expect(NormalizedEventSchema.safeParse(error).success).toBe(true);
		expect(NormalizedEventSchema.safeParse(warning).success).toBe(true);
	});

	it("rejects invalid adapterId", () => {
		const event = {
			kind: "message.delta",
			timestamp: Date.now(),
			adapterId: "openai",
			adapterSessionId: "s1",
			text: "hi",
			role: "assistant",
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(false);
	});

	it("rejects missing required fields", () => {
		expect(
			NormalizedEventSchema.safeParse({
				kind: "message.delta",
				timestamp: Date.now(),
			}).success,
		).toBe(false);
	});

	it("passes through unknown event kinds (forward compat)", () => {
		const event = {
			kind: "future.event",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		};
		const result = NormalizedEventSchema.safeParse(event);
		expect(result.success).toBe(true);
	});

	it("accepts valid usage.updated", () => {
		const event = {
			kind: "usage.updated",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
			inputTokens: 500,
			outputTokens: 200,
			totalCostUsd: 0.05,
		};
		expect(NormalizedEventSchema.safeParse(event).success).toBe(true);
	});

	it("accepts valid subagent events", () => {
		const started = {
			kind: "subagent.started",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			subagentId: "sa1",
			description: "Research agent",
		};
		const completed = {
			kind: "subagent.completed",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			subagentId: "sa1",
		};
		expect(NormalizedEventSchema.safeParse(started).success).toBe(true);
		expect(NormalizedEventSchema.safeParse(completed).success).toBe(true);
	});
});
