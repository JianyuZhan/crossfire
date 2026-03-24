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
	MessageDeltaEvent,
	MessageFinalEvent,
	NormalizedEvent,
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
