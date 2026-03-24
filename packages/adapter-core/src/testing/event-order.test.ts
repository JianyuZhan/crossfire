import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../types.js";
import { assertEventOrder } from "./helpers.js";

describe("assertEventOrder (self-test)", () => {
	it("passes for correctly ordered events", () => {
		const events: NormalizedEvent[] = [
			{
				kind: "tool.call",
				toolUseId: "t1",
				toolName: "bash",
				input: {},
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "tool.result",
				toolUseId: "t1",
				toolName: "bash",
				success: true,
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 100,
				timestamp: 3,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
		];
		expect(() => assertEventOrder(events)).not.toThrow();
	});

	it("fails when tool.result precedes tool.call", () => {
		const events: NormalizedEvent[] = [
			{
				kind: "tool.result",
				toolUseId: "t1",
				toolName: "bash",
				success: true,
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "tool.call",
				toolUseId: "t1",
				toolName: "bash",
				input: {},
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
		];
		expect(() => assertEventOrder(events)).toThrow(/must precede tool.result/);
	});

	it("fails when approval.resolved precedes approval.request", () => {
		const events: NormalizedEvent[] = [
			{
				kind: "approval.resolved",
				requestId: "r1",
				decision: "allow",
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "approval.request",
				requestId: "r1",
				approvalType: "tool",
				title: "Test",
				payload: {},
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
		];
		expect(() => assertEventOrder(events)).toThrow(
			/must precede approval.resolved/,
		);
	});

	it("fails when events appear after turn.completed", () => {
		const events: NormalizedEvent[] = [
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 100,
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "message.delta",
				text: "late message",
				role: "assistant",
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
		];
		expect(() => assertEventOrder(events)).toThrow(/must be last event/);
	});

	it("allows events from different turns after turn.completed", () => {
		const events: NormalizedEvent[] = [
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 100,
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "message.delta",
				text: "new turn",
				role: "assistant",
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t2",
			},
		];
		expect(() => assertEventOrder(events)).not.toThrow();
	});

	it("fails when session.started appears multiple times", () => {
		const caps: import("../capabilities.js").AdapterCapabilities = {
			supportsResume: true,
			resumeMode: "protocol-native",
			resumeStability: "stable",
			supportsExternalHistoryInjection: true,
			supportsRawThinking: false,
			supportsReasoningSummary: false,
			supportsPlan: false,
			supportsApproval: true,
			supportsInterrupt: true,
			supportsSubagents: false,
			supportsStreamingDelta: true,
		};
		const events: NormalizedEvent[] = [
			{
				kind: "session.started",
				providerSessionId: "ps1",
				model: "haiku",
				tools: [],
				capabilities: caps,
				timestamp: 1,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "turn.completed",
				status: "completed",
				durationMs: 100,
				timestamp: 2,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t1",
			},
			{
				kind: "session.started",
				providerSessionId: "ps2",
				model: "haiku",
				tools: [],
				capabilities: caps,
				timestamp: 3,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "t2",
			},
		];
		expect(() => assertEventOrder(events)).toThrow(
			/session.started must appear at most once/,
		);
	});
});
