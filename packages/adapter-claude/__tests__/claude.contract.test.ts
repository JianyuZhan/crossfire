import {
	type MockAdapterFactory,
	type ScenarioFixture,
	type ScenarioStep,
	runContractTests,
} from "@crossfire/adapter-core/testing";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type { QueryFn, SdkMessage } from "../src/types.js";

// biome-ignore lint: loose type for test mock hooks
type MockHooks = Record<
	string,
	Array<{
		hooks: Array<
			(input: any, toolUseID: string | undefined, opts: any) => Promise<any>
		>;
	}>
>;

const DUMMY_SIGNAL = new AbortController().signal;

/**
 * Split fixture steps into per-turn groups.
 * Each group ends with either "turn-result" or "error".
 */
function splitByTurns(steps: ScenarioStep[]): ScenarioStep[][] {
	const turns: ScenarioStep[][] = [];
	let current: ScenarioStep[] = [];
	for (const step of steps) {
		current.push(step);
		if (step.kind === "turn-result" || step.kind === "error") {
			turns.push(current);
			current = [];
		}
	}
	if (current.length > 0) turns.push(current);
	return turns;
}

/**
 * Convert scenario steps to SDK messages (for stream-based events only).
 * Hook-based events (tool-call, tool-result, etc.) are handled separately.
 */
function stepToSdkMessages(step: ScenarioStep): SdkMessage[] {
	switch (step.kind) {
		case "session-init":
			return [
				{
					type: "system/init",
					sessionId: step.sessionId,
					model: step.model,
					tools: [],
				},
			];
		case "assistant-delta":
			return [
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: step.text },
					},
				},
			];
		case "thinking-delta":
			return [
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "thinking_delta", thinking: step.text },
					},
				},
			];
		case "turn-result":
			return [
				{
					type: "result",
					subtype: "success",
					usage: step.usage
						? {
								input_tokens: step.usage.inputTokens,
								output_tokens: step.usage.outputTokens,
							}
						: { input_tokens: 0, output_tokens: 0 },
					duration_ms: 100,
					cost_usd: 0,
				},
			];
		default:
			return [];
	}
}

/**
 * Creates a mock queryFn that replays scenario steps as SDK messages.
 * Handles multi-turn scenarios by advancing through turn groups on each call.
 */
function createMockFactory(fixture: ScenarioFixture): {
	queryFn: QueryFn;
	turnGroups: ScenarioStep[][];
} {
	const turnGroups = splitByTurns(fixture.steps);
	let turnIndex = 0;
	let interruptCalled = false;

	const queryFn: QueryFn = (options) => {
		const steps = turnGroups[turnIndex] ?? [];
		turnIndex++;
		interruptCalled = false;

		async function* generate(): AsyncGenerator<SdkMessage, void, unknown> {
			for (const step of steps) {
				// Check interrupt flag before each step
				if (interruptCalled) {
					yield {
						type: "result",
						subtype: "interrupted",
						duration_ms: 0,
						usage: { input_tokens: 0, output_tokens: 0 },
						cost_usd: 0,
					};
					return;
				}

				// Handle error: throw to trigger run.error emission
				if (step.kind === "error") {
					throw new Error(step.message);
				}

				// Handle tool-call: invoke PreToolUse hook
				if (step.kind === "tool-call") {
					const hooks = options.hooks as MockHooks;
					await hooks?.PreToolUse?.[0]?.hooks?.[0](
						{
							tool_use_id: step.toolUseId,
							tool_name: step.toolName,
							tool_input: step.input,
						},
						step.toolUseId,
						{ signal: DUMMY_SIGNAL },
					);
					continue;
				}

				// Handle tool-result: invoke PostToolUse or PostToolUseFailure hook
				if (step.kind === "tool-result") {
					const hooks = options.hooks as MockHooks;
					if (step.success) {
						await hooks?.PostToolUse?.[0]?.hooks?.[0](
							{
								tool_use_id: step.toolUseId,
								tool_name: step.toolName,
								tool_response: step.output,
							},
							step.toolUseId,
							{ signal: DUMMY_SIGNAL },
						);
					} else {
						await hooks?.PostToolUseFailure?.[0]?.hooks?.[0](
							{
								tool_use_id: step.toolUseId,
								tool_name: step.toolName,
								error: "Tool failed",
							},
							step.toolUseId,
							{ signal: DUMMY_SIGNAL },
						);
					}
					continue;
				}

				// Handle approval-request: call canUseTool which blocks until approve() is called
				if (step.kind === "approval-request") {
					if (options.canUseTool) {
						await options.canUseTool(
							step.title,
							{},
							{ toolUseID: step.requestId },
						);
					}
					continue;
				}

				// Handle approval-resolved: already handled by approve() resolving the canUseTool promise
				if (step.kind === "approval-resolved") {
					continue;
				}

				// Handle subagent-started: invoke SubagentStart hook
				if (step.kind === "subagent-started") {
					const hooks = options.hooks as MockHooks;
					await hooks?.SubagentStart?.[0]?.hooks?.[0](
						{ agent_id: step.subagentId },
						undefined,
						{ signal: DUMMY_SIGNAL },
					);
					continue;
				}

				// Handle subagent-completed: invoke SubagentStop hook
				if (step.kind === "subagent-completed") {
					const hooks = options.hooks as MockHooks;
					await hooks?.SubagentStop?.[0]?.hooks?.[0](
						{ agent_id: step.subagentId },
						undefined,
						{ signal: DUMMY_SIGNAL },
					);
					continue;
				}

				// Handle plan-updated: not yet supported by Claude SDK, skip for now
				if (step.kind === "plan-updated") {
					continue;
				}

				// Handle warning: not yet supported by Claude SDK, skip for now
				if (step.kind === "warning") {
					continue;
				}

				// Handle stream-based steps: yield SDK messages
				const sdkMsgs = stepToSdkMessages(step);
				for (const msg of sdkMsgs) {
					yield msg;
				}
			}
		}

		return {
			messages: generate(),
			interrupt: () => {
				interruptCalled = true;
			},
		};
	};

	return { queryFn, turnGroups };
}

/**
 * MockAdapterFactory for contract tests.
 * Creates a ClaudeAdapter with a mock queryFn that replays scenario steps.
 */
const factory: MockAdapterFactory = {
	async create(fixture: ScenarioFixture) {
		const { queryFn } = createMockFactory(fixture);
		return new ClaudeAdapter({ queryFn });
	},
	async cleanup() {
		// No cleanup needed for ClaudeAdapter
	},
};

// Run the contract test suite
runContractTests("Claude", factory);
