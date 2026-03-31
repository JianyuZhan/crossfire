import type {
	AdapterCapabilities,
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
	TurnHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import type { ProfileConfig } from "../src/profile/schema.js";
import {
	classifyPromptTemplateFamily,
	parseClassifierOutput,
} from "../src/profile/topic-template-classifier.js";
import type { AdapterFactoryMap } from "../src/wiring/create-adapters.js";

const TEST_CAPABILITIES: AdapterCapabilities = {
	supportsResume: false,
	resumeMode: "stateless",
	resumeStability: "none",
	supportsExternalHistoryInjection: false,
	supportsRawThinking: false,
	supportsReasoningSummary: false,
	supportsPlan: true,
	supportsApproval: false,
	supportsInterrupt: false,
	supportsSubagents: false,
	supportsStreamingDelta: true,
};

const TEST_PROFILE: ProfileConfig = {
	name: "judge_profile",
	agent: "claude_code",
	model: "test-model",
	prompt_family: "auto",
	inherit_global_config: true,
	mcp_servers: {},
	filePath: "/tmp/judge.json",
};

describe("parseClassifierOutput", () => {
	it("parses strict JSON", () => {
		expect(
			parseClassifierOutput(
				'{"family":"code","confidence":0.92,"reason":"Repository refactor topic."}',
			),
		).toEqual({
			family: "code",
			confidence: 0.92,
			reason: "Repository refactor topic.",
		});
	});

	it("parses JSON wrapped in markdown fences", () => {
		expect(
			parseClassifierOutput(
				'```json\n{"family":"general","confidence":0.61,"reason":"Business topic."}\n```',
			),
		).toEqual({
			family: "general",
			confidence: 0.61,
			reason: "Business topic.",
		});
	});

	it("rejects malformed payloads", () => {
		expect(parseClassifierOutput("not json")).toBeUndefined();
		expect(
			parseClassifierOutput('{"family":"other","confidence":1,"reason":"bad"}'),
		).toBeUndefined();
	});
});

describe("classifyPromptTemplateFamily", () => {
	it("uses the LLM response when valid JSON is returned", async () => {
		const adapter = createMockAdapter((emit) => {
			emit({
				kind: "message.final",
				adapterId: "claude",
				adapterSessionId: "session-1",
				turnId: "template-classifier",
				role: "assistant",
				text: '{"family":"code","confidence":0.88,"reason":"The topic is about a repository refactor."}',
				timestamp: Date.now(),
			});
			emit({
				kind: "turn.completed",
				adapterId: "claude",
				adapterSessionId: "session-1",
				turnId: "template-classifier",
				status: "completed",
				durationMs: 25,
				timestamp: Date.now(),
			});
		});
		const factories = createFactoryMap(adapter);

		const result = await classifyPromptTemplateFamily({
			topic: "Should we refactor the repository data layer?",
			profile: TEST_PROFILE,
			factories,
			timeoutMs: 100,
		});

		expect(result).toEqual({
			family: "code",
			confidence: 0.88,
			reason: "The topic is about a repository refactor.",
			source: "llm",
		});
		expect(adapter.startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					systemPrompt: expect.stringContaining("Return strict JSON only"),
				}),
			}),
		);
		expect(adapter.sendTurn).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				turnId: "template-classifier",
				executionMode: "plan",
			}),
		);
		expect(adapter.close).toHaveBeenCalledTimes(1);
	});

	it("falls back to heuristic when the classifier output is invalid", async () => {
		const adapter = createMockAdapter((emit) => {
			emit({
				kind: "message.final",
				adapterId: "claude",
				adapterSessionId: "session-1",
				turnId: "template-classifier",
				role: "assistant",
				text: "This looks like code.",
				timestamp: Date.now(),
			});
			emit({
				kind: "turn.completed",
				adapterId: "claude",
				adapterSessionId: "session-1",
				turnId: "template-classifier",
				status: "completed",
				durationMs: 25,
				timestamp: Date.now(),
			});
		});

		const result = await classifyPromptTemplateFamily({
			topic: "Should we refactor the repository data layer?",
			profile: TEST_PROFILE,
			factories: createFactoryMap(adapter),
			timeoutMs: 100,
		});

		expect(result.family).toBe("code");
		expect(result.source).toBe("fallback");
		expect(result.reason).toContain("Fallback heuristic");
	});
});

function createFactoryMap(adapter: AgentAdapter): AdapterFactoryMap {
	return {
		claude: () => adapter,
		codex: () => adapter,
		gemini: () => adapter,
	};
}

function createMockAdapter(
	onSendTurn: (
		emit: (event: NormalizedEvent) => void,
		input: TurnInput,
	) => void,
): AgentAdapter & {
	startSession: ReturnType<typeof vi.fn>;
	sendTurn: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
} {
	let callback: ((event: NormalizedEvent) => void) | undefined;
	const session: SessionHandle = {
		adapterSessionId: "session-1",
		providerSessionId: undefined,
		adapterId: "claude",
		transcript: [],
	};
	return {
		id: "claude",
		capabilities: TEST_CAPABILITIES,
		startSession: vi.fn(async () => session),
		sendTurn: vi.fn(async (_handle: SessionHandle, input: TurnInput) => {
			onSendTurn((event) => callback?.(event), input);
			const result: TurnHandle = {
				turnId: input.turnId,
				status: "completed",
			};
			return result;
		}),
		onEvent(cb: (event: NormalizedEvent) => void) {
			callback = cb;
			return () => {
				if (callback === cb) callback = undefined;
			};
		},
		close: vi.fn(async () => undefined),
	};
}
