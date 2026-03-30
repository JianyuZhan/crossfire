import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import {
	CommandStatusLine,
	commandStatusLineHeight,
} from "../src/components/command-status-line.js";
import type { CommandState } from "../src/state/types.js";

function makeState(overrides: Partial<CommandState> = {}): CommandState {
	return {
		mode: "normal",
		pendingApprovals: [],
		...overrides,
	};
}

describe("CommandStatusLine", () => {
	it("stays hidden in plain normal mode", () => {
		const { lastFrame } = render(<CommandStatusLine state={makeState()} />);
		expect(lastFrame()).toBe("");
	});

	it("renders a multi-line approval card with action hints", () => {
		const state = makeState({
			mode: "approval",
			pendingApprovals: [
				{
					requestId: "ar-c-1-call-1",
					adapterId: "codex",
					adapterSessionId: "codex-session-1",
					approvalType: "command",
					title: "/bin/zsh -lc curl https://example.com/very/long/path",
					detail:
						'Command: curl https://example.com/very/long/path --header "Authorization: Bearer ..."',
					suggestion: "allow",
				},
			],
		});

		const { lastFrame } = render(
			<CommandStatusLine state={state} width={72} />,
		);
		const output = lastFrame();
		expect(output).toContain("APPROVAL REQUIRED");
		expect(output).toContain("codex");
		expect(output).toContain("Command:");
		expect(output).toContain("/approve ar-c-1-call-1");
		expect(output).toContain("/deny ar-c-1-call-1");
	});

	it("reports taller fixed height when approvals are visible", () => {
		const normalHeight = commandStatusLineHeight(makeState(), 80);
		const approvalHeight = commandStatusLineHeight(
			makeState({
				mode: "approval",
				pendingApprovals: [
					{
						requestId: "ar-1",
						adapterId: "claude",
						adapterSessionId: "claude-session-1",
						approvalType: "tool",
						title: "Approve tool: WebFetch",
						detail:
							'Tool: WebFetch {"url":"https://example.com","prompt":"Explain the business model"}',
					},
				],
			}),
			80,
		);
		expect(normalHeight).toBe(0);
		expect(approvalHeight).toBeGreaterThan(1);
	});
});
