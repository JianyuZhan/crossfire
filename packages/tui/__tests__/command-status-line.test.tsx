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
					options: [
						{
							id: "accept",
							label: "Allow once",
							kind: "allow",
							isDefault: true,
						},
						{
							id: "acceptForSession",
							label: "Allow for session",
							kind: "allow-always",
							scope: "session",
						},
						{
							id: "decline",
							label: "Reject",
							kind: "deny",
						},
					],
				},
			],
		});

		const { lastFrame } = render(
			<CommandStatusLine state={state} width={72} />,
		);
		const output = lastFrame();
		expect(output).toContain("APPROVAL REQUIRED");
		expect(output).toContain("/approve all");
		expect(output).toContain("codex");
		expect(output).toContain("Command:");
		expect(output).toContain("Allow once");
		expect(output).toContain("/approve 1 2");
		expect(output).toContain("/deny 1");
	});

	it("shows a bulk session-allow hint when all pending approvals support it", () => {
		const state = makeState({
			mode: "approval",
			pendingApprovals: [
				{
					requestId: "ar-1",
					adapterId: "claude",
					adapterSessionId: "claude-session-1",
					approvalType: "tool",
					title: "Approve tool: WebFetch",
					detail: 'Tool: WebFetch {"url":"https://example.com/a"}',
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
						{
							id: "deny",
							label: "Reject",
							kind: "deny",
						},
					],
				},
				{
					requestId: "ar-2",
					adapterId: "claude",
					adapterSessionId: "claude-session-1",
					approvalType: "tool",
					title: "Approve tool: WebFetch",
					detail: 'Tool: WebFetch {"url":"https://example.com/b"}',
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
						{
							id: "deny",
							label: "Reject",
							kind: "deny",
						},
					],
				},
			],
		});

		const { lastFrame } = render(
			<CommandStatusLine state={state} width={72} />,
		);
		expect(lastFrame()).toContain("Session shortcut: /approve all 2");
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

	it("renders command output from lastOutput", () => {
		const state = makeState({
			lastOutput:
				'=== proposer (claude) ===\nPreset: research\nTranslation: {"permissionMode":"default"}',
		});

		const { lastFrame } = render(
			<CommandStatusLine state={state} width={72} />,
		);
		const output = lastFrame();
		expect(output).toContain("proposer");
		expect(output).toContain("Preset: research");
		expect(output).toContain("Translation:");
	});

	it("shows command output together with paused state when both are present", () => {
		const state = makeState({
			lastOutput: "Policy state not yet available.",
			livePaused: true,
		});

		const { lastFrame } = render(
			<CommandStatusLine state={state} width={72} />,
		);
		const output = lastFrame();
		expect(output).toContain("Policy state not yet available.");
		expect(output).toContain("PAUSED");
	});
});
