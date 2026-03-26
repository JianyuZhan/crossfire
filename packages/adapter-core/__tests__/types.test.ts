import { describe, expect, expectTypeOf, it } from "vitest";
import type { AdapterCapabilities } from "../src/capabilities.js";
import {
	CLAUDE_CAPABILITIES,
	CODEX_CAPABILITIES,
	GEMINI_CAPABILITIES,
} from "../src/capabilities.js";
import {
	AdapterError,
	ApprovalTimeoutError,
	ResumeError,
	TransportError,
} from "../src/errors.js";
import type {
	AgentAdapter,
	ApprovalRequestEvent,
	BaseEvent,
	LocalTurnMetrics,
	MessageDeltaEvent,
	MessageFinalEvent,
	NormalizedEvent,
	ProviderUsageMetrics,
	ProviderUsageSemantics,
	RunErrorEvent,
	RunWarningEvent,
	SessionHandle,
	SessionStartedEvent,
	StartSessionInput,
	ThinkingDeltaEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnCompletedEvent,
	TurnHandle,
	TurnInput,
	TurnRecord,
	UsageUpdatedEvent,
} from "../src/types.js";

describe("NormalizedEvent types", () => {
	it("discriminates on kind field", () => {
		const event: NormalizedEvent = {
			kind: "session.started",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			model: "claude-haiku-4-5-20251001",
			tools: [],
			providerSessionId: "ps1",
			capabilities: CLAUDE_CAPABILITIES,
		};
		expect(event.kind).toBe("session.started");
		if (event.kind === "session.started") {
			expectTypeOf(event.model).toBeString();
			expectTypeOf(event.providerSessionId).toBeString();
		}
	});

	it("SessionHandle allows undefined providerSessionId", () => {
		const handle: SessionHandle = {
			adapterSessionId: "s1",
			providerSessionId: undefined,
			adapterId: "claude",
		};
		expect(handle.providerSessionId).toBeUndefined();
	});

	it("SessionHandle allows string providerSessionId", () => {
		const handle: SessionHandle = {
			adapterSessionId: "s1",
			providerSessionId: "ps1",
			adapterId: "codex",
		};
		expect(handle.providerSessionId).toBe("ps1");
	});

	it("TurnCompletedEvent has durationMs", () => {
		const event: TurnCompletedEvent = {
			kind: "turn.completed",
			timestamp: Date.now(),
			adapterId: "gemini",
			adapterSessionId: "s1",
			turnId: "t1",
			status: "completed",
			durationMs: 1500,
		};
		expect(event.durationMs).toBe(1500);
	});

	it("TurnCompletedEvent accepts optional usage", () => {
		const event: TurnCompletedEvent = {
			kind: "turn.completed",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			turnId: "t1",
			status: "completed",
			durationMs: 1500,
			usage: { inputTokens: 100, outputTokens: 50, totalCostUsd: 0.01 },
		};
		expect(event.usage?.inputTokens).toBe(100);
	});

	it("ApprovalRequestEvent has approvalType union", () => {
		const event: ApprovalRequestEvent = {
			kind: "approval.request",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			turnId: "t1",
			requestId: "r1",
			approvalType: "command",
			title: "Run rm",
			payload: { command: "rm -rf /" },
		};
		expect(event.approvalType).toBe("command");
	});

	it("ThinkingDeltaEvent distinguishes raw-thinking from reasoning-summary", () => {
		const raw: ThinkingDeltaEvent = {
			kind: "thinking.delta",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			text: "thinking...",
			thinkingType: "raw-thinking",
		};
		const summary: ThinkingDeltaEvent = {
			kind: "thinking.delta",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s1",
			text: "reasoning...",
			thinkingType: "reasoning-summary",
		};
		expect(raw.thinkingType).toBe("raw-thinking");
		expect(summary.thinkingType).toBe("reasoning-summary");
	});

	it("adapterId is restricted to literal union", () => {
		const event: BaseEvent = {
			kind: "test",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
		};
		// @ts-expect-error — "openai" is not valid
		const bad: BaseEvent = { ...event, adapterId: "openai" };
		expect(bad).toBeDefined(); // runtime doesn't enforce, but TS does
	});
});

describe("AdapterCapabilities presets", () => {
	it("Claude supports raw thinking but not reasoning summary", () => {
		expect(CLAUDE_CAPABILITIES.supportsRawThinking).toBe(true);
		expect(CLAUDE_CAPABILITIES.supportsReasoningSummary).toBe(false);
		expect(CLAUDE_CAPABILITIES.supportsApproval).toBe(true);
		expect(CLAUDE_CAPABILITIES.supportsSubagents).toBe(true);
	});

	it("Codex supports reasoning summary and plan", () => {
		expect(CODEX_CAPABILITIES.supportsReasoningSummary).toBe(true);
		expect(CODEX_CAPABILITIES.supportsPlan).toBe(true);
		expect(CODEX_CAPABILITIES.supportsRawThinking).toBe(false);
	});

	it("Gemini has experimental resume and no approval", () => {
		expect(GEMINI_CAPABILITIES.resumeStability).toBe("experimental");
		expect(GEMINI_CAPABILITIES.supportsApproval).toBe(false);
		expect(GEMINI_CAPABILITIES.supportsInterrupt).toBe(false);
		expect(GEMINI_CAPABILITIES.supportsRawThinking).toBe(true);
	});
});

describe("Error types", () => {
	it("AdapterError has adapterId and recoverable", () => {
		const err = new AdapterError("test", "claude", true);
		expect(err.message).toBe("test");
		expect(err.adapterId).toBe("claude");
		expect(err.recoverable).toBe(true);
		expect(err.name).toBe("AdapterError");
		expect(err).toBeInstanceOf(Error);
	});

	it("ResumeError is recoverable by default", () => {
		const err = new ResumeError("gemini", "s1");
		expect(err.recoverable).toBe(true);
		expect(err.sessionId).toBe("s1");
		expect(err.name).toBe("ResumeError");
		expect(err).toBeInstanceOf(AdapterError);
	});

	it("ApprovalTimeoutError is not recoverable", () => {
		const err = new ApprovalTimeoutError("codex", "r1");
		expect(err.recoverable).toBe(false);
		expect(err.requestId).toBe("r1");
	});

	it("TransportError is recoverable by default", () => {
		const err = new TransportError("codex", "connection lost");
		expect(err.recoverable).toBe(true);
		expect(err.name).toBe("TransportError");
	});
});

describe("Incremental Prompt & Token Tracking types", () => {
	it("TurnRecord has required fields", () => {
		const record: TurnRecord = {
			roundNumber: 1,
			role: "proposer",
			content: "test content",
		};
		expect(record.roundNumber).toBe(1);
		expect(record.role).toBe("proposer");
		expect(record.content).toBe("test content");
		expect(record.meta).toBeUndefined();
	});

	it("TurnRecord accepts optional meta", () => {
		const record: TurnRecord = {
			roundNumber: 2,
			role: "challenger",
			content: "challenge",
			meta: {
				stance: "against",
				confidence: 0.8,
				keyPoints: ["point1", "point2"],
				concessions: ["concession1"],
			},
		};
		expect(record.meta?.stance).toBe("against");
		expect(record.meta?.confidence).toBe(0.8);
		expect(record.meta?.keyPoints).toHaveLength(2);
	});

	it("LocalTurnMetrics has semantic/overhead/total split", () => {
		const metrics: LocalTurnMetrics = {
			semanticChars: 100,
			semanticUtf8Bytes: 200,
			adapterOverheadChars: 50,
			adapterOverheadUtf8Bytes: 100,
			totalChars: 150,
			totalUtf8Bytes: 300,
		};
		expect(metrics.totalChars).toBe(150);
		expect(metrics.totalTokensEstimate).toBeUndefined();
	});

	it("LocalTurnMetrics accepts optional token estimate", () => {
		const metrics: LocalTurnMetrics = {
			semanticChars: 100,
			semanticUtf8Bytes: 200,
			adapterOverheadChars: 0,
			adapterOverheadUtf8Bytes: 0,
			totalChars: 100,
			totalUtf8Bytes: 200,
			totalTokensEstimate: 75,
			tokenEstimateMethod: "chars/4",
		};
		expect(metrics.totalTokensEstimate).toBe(75);
		expect(metrics.tokenEstimateMethod).toBe("chars/4");
	});

	it("ProviderUsageMetrics includes semantics label", () => {
		const usage: ProviderUsageMetrics = {
			inputTokens: 100,
			outputTokens: 200,
			semantics: "per_turn",
		};
		expect(usage.semantics).toBe("per_turn");
		expect(usage.cacheReadTokens).toBeUndefined();
	});

	it("ProviderUsageMetrics supports all semantics values", () => {
		const semanticsValues: ProviderUsageSemantics[] = [
			"per_turn",
			"cumulative_thread_total",
			"session_delta_or_cached",
			"unknown",
		];
		for (const sem of semanticsValues) {
			const usage: ProviderUsageMetrics = {
				semantics: sem,
			};
			expect(usage.semantics).toBe(sem);
		}
	});

	it("ProviderUsageMetrics accepts cache tokens and raw data", () => {
		const usage: ProviderUsageMetrics = {
			inputTokens: 100,
			outputTokens: 200,
			cacheReadTokens: 1000,
			cacheWriteTokens: 50,
			semantics: "session_delta_or_cached",
			raw: { provider: "claude", model: "haiku" },
		};
		expect(usage.cacheReadTokens).toBe(1000);
		expect(usage.cacheWriteTokens).toBe(50);
		expect(usage.raw).toEqual({ provider: "claude", model: "haiku" });
	});

	it("UsageUpdatedEvent supports new optional fields", () => {
		const event: UsageUpdatedEvent = {
			kind: "usage.updated",
			timestamp: Date.now(),
			adapterId: "claude",
			adapterSessionId: "s1",
			inputTokens: 3,
			outputTokens: 500,
			cacheReadTokens: 1200,
			cacheWriteTokens: 50,
			semantics: "session_delta_or_cached",
			localMetrics: {
				semanticChars: 100,
				semanticUtf8Bytes: 200,
				adapterOverheadChars: 0,
				adapterOverheadUtf8Bytes: 0,
				totalChars: 100,
				totalUtf8Bytes: 200,
			},
		};
		expect(event.cacheReadTokens).toBe(1200);
		expect(event.semantics).toBe("session_delta_or_cached");
		expect(event.localMetrics?.totalChars).toBe(100);
	});

	it("UsageUpdatedEvent backward compatible without new fields", () => {
		const event: UsageUpdatedEvent = {
			kind: "usage.updated",
			timestamp: Date.now(),
			adapterId: "codex",
			adapterSessionId: "s2",
			inputTokens: 100,
			outputTokens: 50,
		};
		expect(event.inputTokens).toBe(100);
		expect(event.cacheReadTokens).toBeUndefined();
		expect(event.semantics).toBeUndefined();
		expect(event.localMetrics).toBeUndefined();
	});
});
