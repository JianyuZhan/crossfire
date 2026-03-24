export type ScenarioStep =
	| { kind: "session-init"; sessionId: string; model: string }
	| { kind: "assistant-delta"; text: string }
	| {
			kind: "thinking-delta";
			text: string;
			thinkingType: "raw-thinking" | "reasoning-summary";
	  }
	| { kind: "tool-call"; toolUseId: string; toolName: string; input: unknown }
	| {
			kind: "tool-result";
			toolUseId: string;
			toolName: string;
			success: boolean;
			output?: unknown;
	  }
	| {
			kind: "approval-request";
			requestId: string;
			approvalType: string;
			title: string;
	  }
	| { kind: "approval-resolved"; requestId: string; decision: "allow" | "deny" }
	| { kind: "subagent-started"; subagentId: string }
	| { kind: "subagent-completed"; subagentId: string }
	| {
			kind: "turn-result";
			usage?: { inputTokens: number; outputTokens: number };
	  }
	| { kind: "error"; message: string; recoverable: boolean }
	| { kind: "warning"; message: string }
	| {
			kind: "plan-updated";
			steps: Array<{ description: string; status: string }>;
	  };

export interface ScenarioFixture {
	name: string;
	steps: ScenarioStep[];
}

export const HAPPY_PATH: ScenarioFixture = {
	name: "happy-path",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{ kind: "assistant-delta", text: "Hello, " },
		{ kind: "assistant-delta", text: "world!" },
		{ kind: "turn-result", usage: { inputTokens: 10, outputTokens: 5 } },
	],
};

export const TOOL_LIFECYCLE: ScenarioFixture = {
	name: "tool-lifecycle",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{
			kind: "tool-call",
			toolUseId: "tu1",
			toolName: "bash",
			input: { command: "ls" },
		},
		{
			kind: "tool-result",
			toolUseId: "tu1",
			toolName: "bash",
			success: true,
			output: "file.txt",
		},
		{ kind: "assistant-delta", text: "Found file.txt" },
		{ kind: "turn-result", usage: { inputTokens: 20, outputTokens: 10 } },
	],
};

export const TOOL_FAILURE: ScenarioFixture = {
	name: "tool-failure",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{
			kind: "tool-call",
			toolUseId: "tu1",
			toolName: "bash",
			input: { command: "bad" },
		},
		{ kind: "tool-result", toolUseId: "tu1", toolName: "bash", success: false },
		{ kind: "turn-result" },
	],
};

export const TRANSPORT_ERROR: ScenarioFixture = {
	name: "transport-error",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{ kind: "error", message: "Connection lost", recoverable: true },
	],
};

export const MULTI_TURN: ScenarioFixture = {
	name: "multi-turn",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{ kind: "assistant-delta", text: "Turn 1 response" },
		{ kind: "turn-result", usage: { inputTokens: 10, outputTokens: 5 } },
		// Second turn: no session-init
		{ kind: "assistant-delta", text: "Turn 2 response" },
		{ kind: "turn-result", usage: { inputTokens: 15, outputTokens: 8 } },
	],
};

export const APPROVAL_LIFECYCLE: ScenarioFixture = {
	name: "approval-lifecycle",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{
			kind: "tool-call",
			toolUseId: "tu1",
			toolName: "bash",
			input: { command: "rm -rf /" },
		},
		{
			kind: "approval-request",
			requestId: "ar1",
			approvalType: "command",
			title: "Run command",
		},
		{ kind: "approval-resolved", requestId: "ar1", decision: "allow" },
		{ kind: "tool-result", toolUseId: "tu1", toolName: "bash", success: true },
		{ kind: "turn-result" },
	],
};

export const PLAN_UPDATED: ScenarioFixture = {
	name: "plan-updated",
	steps: [
		{ kind: "session-init", sessionId: "s1", model: "test-model" },
		{
			kind: "plan-updated",
			steps: [
				{ description: "Analyze code", status: "completed" },
				{ description: "Write fix", status: "in_progress" },
			],
		},
		{ kind: "assistant-delta", text: "Working on it..." },
		{ kind: "turn-result" },
	],
};
