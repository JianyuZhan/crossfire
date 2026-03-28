import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { AgentPanel } from "../src/components/agent-panel.js";
import type {
	AgentTurnSnapshot,
	LiveAgentPanelState,
} from "../src/state/types.js";

function makePanel(
	overrides: Partial<LiveAgentPanelState> = {},
): LiveAgentPanelState {
	return {
		role: "proposer",
		status: "idle",
		thinkingText: "",
		currentMessageText: "",
		tools: [],
		warnings: [],
		...overrides,
	};
}

describe("AgentPanel — live mode", () => {
	it("shows role header", () => {
		const { lastFrame } = render(
			<AgentPanel mode="live" role="proposer" state={makePanel()} />,
		);
		expect(lastFrame()).toContain("Proposer");
	});

	it("shows thinking indicator", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({ status: "thinking", thinkingText: "Analyzing..." })}
			/>,
		);
		expect(lastFrame()).toContain("Thinking");
		expect(lastFrame()).toContain("Analyzing...");
	});

	it("shows speaking with message text", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({
					status: "speaking",
					currentMessageText: "I argue that...",
				})}
			/>,
		);
		expect(lastFrame()).toContain("Responding");
		expect(lastFrame()).toContain("I argue that...");
	});

	it("keeps thinking summary and plan details visible while speaking", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({
					status: "speaking",
					thinkingText: "First inspect the failing path",
					thinkingType: "reasoning-summary",
					currentMessageText: "I argue that...",
					latestPlan: [
						{ id: "step-1", title: "Inspect files", status: "completed" },
					],
					subagents: [
						{
							subagentId: "sa-1",
							description: "Research edge cases",
							status: "running",
						},
					],
				})}
			/>,
		);
		expect(lastFrame()).toContain("Reasoning:");
		expect(lastFrame()).toContain("Inspect files");
		expect(lastFrame()).toContain("Research edge cases");
	});

	it("shows tool calls", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({
					status: "tool",
					tools: [
						{
							toolUseId: "t1",
							toolName: "Read",
							inputSummary: '{"file":"a.ts"}',
							status: "running",
							expanded: true,
						},
					],
				})}
			/>,
		);
		expect(lastFrame()).toContain("Read");
	});

	it("shows error banner", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({ status: "error", error: "Connection timeout" })}
			/>,
		);
		expect(lastFrame()).toContain("Connection timeout");
	});

	it("shows done with duration", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({
					status: "done",
					turnDurationMs: 2500,
					turnStatus: "completed",
				})}
			/>,
		);
		expect(lastFrame()).toContain("2.5s");
	});

	it("strips debate_meta code blocks at render time", () => {
		const { lastFrame } = render(
			<AgentPanel
				mode="live"
				role="proposer"
				state={makePanel({
					status: "speaking",
					currentMessageText:
						'My argument.\n```debate_meta\n{"stance":"agree"}\n```',
				})}
			/>,
		);
		expect(lastFrame()).toContain("My argument.");
		expect(lastFrame()).not.toContain("debate_meta");
	});
});

describe("AgentPanel — snapshot mode", () => {
	it("renders completed snapshot content", () => {
		const snapshot: AgentTurnSnapshot = {
			messageText: "I believe we should...",
			tools: [],
			turnDurationMs: 1500,
			warnings: [],
		};
		const { lastFrame } = render(
			<AgentPanel mode="snapshot" role="challenger" snapshot={snapshot} />,
		);
		expect(lastFrame()).toContain("Challenger");
		expect(lastFrame()).toContain("I believe we should...");
		expect(lastFrame()).toContain("1.5s");
	});
});

describe("AgentPanel — idle mode", () => {
	it("shows waiting label", () => {
		const { lastFrame } = render(<AgentPanel mode="idle" role="challenger" />);
		expect(lastFrame()).toContain("Challenger");
		expect(lastFrame()).toContain("Waiting...");
	});
});
