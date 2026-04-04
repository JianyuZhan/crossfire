import type {
	AgentAdapter,
	NormalizedEvent,
	SessionHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import {
	CLAUDE_CAPABILITIES,
	CODEX_CAPABILITIES,
	compilePolicy,
} from "@crossfire/adapter-core";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { describe, expect, it } from "vitest";
import { type AdapterMap, runDebate } from "../src/runner.js";

function createScriptedAdapter(
	id: "claude" | "codex" | "gemini",
	scripts: Record<string, NormalizedEvent[]>,
	recordedTurns: TurnInput[],
): AgentAdapter {
	const listeners: Set<(e: NormalizedEvent) => void> = new Set();
	const sessionId = `${id}-s1`;
	return {
		id,
		capabilities: id === "claude" ? CLAUDE_CAPABILITIES : CODEX_CAPABILITIES,
		async startSession() {
			return {
				adapterSessionId: sessionId,
				providerSessionId: `p-${sessionId}`,
				adapterId: id,
				transcript: [],
			};
		},
		async sendTurn(_handle: SessionHandle, input: TurnInput) {
			recordedTurns.push(input);
			const eventsForTurn = scripts[input.turnId] ?? [
				{
					kind: "turn.completed" as const,
					status: "completed" as const,
					durationMs: 0,
					timestamp: Date.now(),
					adapterId: id,
					adapterSessionId: sessionId,
					turnId: input.turnId,
				},
			];
			setTimeout(() => {
				for (const e of eventsForTurn) {
					for (const l of listeners) l(e);
				}
			}, 0);
			return { turnId: input.turnId, status: "running" as const };
		},
		onEvent(cb: (e: NormalizedEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		async close() {},
	};
}

function turnEvents(
	turnId: string,
	adapterId: "claude" | "codex",
	sessionId: string,
	content: string,
	meta: {
		stance: string;
		confidence: number;
		key_points: string[];
		wants_to_conclude?: boolean;
	},
): NormalizedEvent[] {
	return [
		{
			kind: "tool.call",
			toolUseId: `tu-${turnId}`,
			toolName: "debate_meta",
			input: meta,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "message.final",
			text: content,
			role: "assistant",
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 100,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

function judgeTurnEvents(
	turnId: string,
	adapterId: "claude" | "codex" | "gemini",
	sessionId: string,
): NormalizedEvent[] {
	return [
		{
			kind: "turn.completed",
			status: "completed",
			durationMs: 50,
			timestamp: Date.now(),
			adapterId,
			adapterSessionId: sessionId,
			turnId,
		},
	];
}

const debateConfig: DebateConfig = {
	topic: "Policy flow test",
	maxRounds: 1,
	judgeEveryNRounds: 0,
	convergenceThreshold: 0.3,
};

const defaultMeta = {
	stance: "agree",
	confidence: 0.8,
	key_points: ["point"],
};

describe("runner policy flow (real runDebate path)", () => {
	describe("per-turn policy forwarding", () => {
		it("proposer sendTurn receives compiled policy with correct preset", async () => {
			const proposerTurns: TurnInput[] = [];
			const challengerTurns: TurnInput[] = [];

			const proposer = createScriptedAdapter(
				"claude",
				{
					"p-1": turnEvents(
						"p-1",
						"claude",
						"claude-s1",
						"Proposer r1",
						defaultMeta,
					),
				},
				proposerTurns,
			);
			const challenger = createScriptedAdapter(
				"codex",
				{
					"c-1": turnEvents(
						"c-1",
						"codex",
						"codex-s1",
						"Challenger r1",
						defaultMeta,
					),
				},
				challengerTurns,
			);

			const baselineProposer = compilePolicy({
				preset: "guarded",
				role: "proposer",
			});
			const baselineChallenger = compilePolicy({
				preset: "guarded",
				role: "challenger",
			});

			const adapters: AdapterMap = {
				proposer: {
					adapter: proposer,
					session: await proposer.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: baselineProposer,
				},
				challenger: {
					adapter: challenger,
					session: await challenger.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: baselineChallenger,
				},
			};

			await runDebate(debateConfig, adapters);

			expect(proposerTurns.length).toBeGreaterThanOrEqual(1);
			const proposerPolicy = proposerTurns[0].policy;
			expect(proposerPolicy).toBeDefined();
			expect(proposerPolicy?.preset).toBe("guarded");
			expect(proposerPolicy?.capabilities.filesystem).toBe("write");

			expect(challengerTurns.length).toBeGreaterThanOrEqual(1);
			const challengerPolicy = challengerTurns[0].policy;
			expect(challengerPolicy).toBeDefined();
			expect(challengerPolicy?.preset).toBe("guarded");
			expect(
				challengerPolicy?.roleContract.semantics.mayIntroduceNewProposal,
			).toBe(false);
		});

		it("legacyToolPolicyInput carries forward through sendTurn", async () => {
			const proposerTurns: TurnInput[] = [];
			const legacyToolPolicy = {
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
			};

			const proposer = createScriptedAdapter(
				"claude",
				{
					"p-1": turnEvents(
						"p-1",
						"claude",
						"claude-s1",
						"Proposer r1",
						defaultMeta,
					),
				},
				proposerTurns,
			);
			const challenger = createScriptedAdapter(
				"codex",
				{
					"c-1": turnEvents(
						"c-1",
						"codex",
						"codex-s1",
						"Challenger r1",
						defaultMeta,
					),
				},
				[],
			);

			const adapters: AdapterMap = {
				proposer: {
					adapter: proposer,
					session: await proposer.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "proposer",
						legacyToolPolicy,
					}),
					legacyToolPolicyInput: legacyToolPolicy,
				},
				challenger: {
					adapter: challenger,
					session: await challenger.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "challenger",
					}),
				},
			};

			await runDebate(debateConfig, adapters);

			const receivedPolicy = proposerTurns[0].policy;
			expect(receivedPolicy?.capabilities.legacyToolOverrides?.allow).toEqual([
				"Read",
				"Grep",
			]);
			expect(receivedPolicy?.capabilities.legacyToolOverrides?.deny).toEqual([
				"WebFetch",
			]);
		});
	});

	describe("judge baseline policy reuse", () => {
		it("judge sendTurn receives baseline policy compiled upstream", async () => {
			const judgeTurns: TurnInput[] = [];
			const judgeBaseline = compilePolicy({
				preset: "plan",
				role: "judge",
			});

			const proposer = createScriptedAdapter(
				"claude",
				{
					"p-1": turnEvents(
						"p-1",
						"claude",
						"claude-s1",
						"Proposer r1",
						defaultMeta,
					),
				},
				[],
			);
			const challenger = createScriptedAdapter(
				"codex",
				{
					"c-1": turnEvents(
						"c-1",
						"codex",
						"codex-s1",
						"Challenger r1",
						defaultMeta,
					),
				},
				[],
			);
			const judge = createScriptedAdapter(
				"claude",
				{
					"j-1": judgeTurnEvents("j-1", "claude", "claude-s1"),
					"j-final": judgeTurnEvents("j-final", "claude", "claude-s1"),
				},
				judgeTurns,
			);

			const adapters: AdapterMap = {
				proposer: {
					adapter: proposer,
					session: await proposer.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "proposer",
					}),
				},
				challenger: {
					adapter: challenger,
					session: await challenger.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "challenger",
					}),
				},
				judge: {
					adapter: judge,
					session: await judge.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: judgeBaseline,
				},
			};

			await runDebate({ ...debateConfig, judgeEveryNRounds: 1 }, adapters);

			expect(judgeTurns.length).toBeGreaterThanOrEqual(1);
			for (const turn of judgeTurns) {
				expect(turn.policy).toBeDefined();
				expect(turn.policy?.preset).toBe("plan");
				expect(turn.policy?.interaction.approval).toBe("always");
				expect(turn.policy?.roleContract.semantics.exploration).toBe(
					"forbidden",
				);
			}
		});
	});

	describe("smoke: data-flow through real runner", () => {
		it("baseline smoke: compile -> translate boundary -- policy arrives at sendTurn intact", async () => {
			const proposerTurns: TurnInput[] = [];

			const proposer = createScriptedAdapter(
				"claude",
				{
					"p-1": turnEvents(
						"p-1",
						"claude",
						"claude-s1",
						"Proposer r1",
						defaultMeta,
					),
				},
				proposerTurns,
			);
			const challenger = createScriptedAdapter(
				"codex",
				{
					"c-1": turnEvents(
						"c-1",
						"codex",
						"codex-s1",
						"Challenger r1",
						defaultMeta,
					),
				},
				[],
			);

			const baselineProposer = compilePolicy({
				preset: "guarded",
				role: "proposer",
			});
			expect(baselineProposer.preset).toBe("guarded");
			expect(baselineProposer.capabilities).toBeDefined();
			expect(baselineProposer.interaction).toBeDefined();
			expect(baselineProposer.roleContract).toBeDefined();

			const adapters: AdapterMap = {
				proposer: {
					adapter: proposer,
					session: await proposer.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: baselineProposer,
				},
				challenger: {
					adapter: challenger,
					session: await challenger.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "challenger",
					}),
				},
			};

			await runDebate(debateConfig, adapters);

			expect(proposerTurns.length).toBeGreaterThanOrEqual(1);
			const receivedPolicy = proposerTurns[0].policy;
			expect(receivedPolicy).toBeDefined();
			expect(receivedPolicy?.preset).toBe("guarded");
			expect(receivedPolicy?.capabilities.filesystem).toBe("write");
		});

		it("turn override smoke: baseline stored, override takes precedence, baseline clean", async () => {
			const proposerTurns: TurnInput[] = [];
			const legacyToolPolicy = {
				allow: ["Read"],
				deny: ["WebFetch"],
			};
			const baselineProposer = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});

			const proposer = createScriptedAdapter(
				"claude",
				{
					"p-1": turnEvents(
						"p-1",
						"claude",
						"claude-s1",
						"Proposer r1",
						defaultMeta,
					),
				},
				proposerTurns,
			);
			const challenger = createScriptedAdapter(
				"codex",
				{
					"c-1": turnEvents(
						"c-1",
						"codex",
						"codex-s1",
						"Challenger r1",
						defaultMeta,
					),
				},
				[],
			);

			const adapters: AdapterMap = {
				proposer: {
					adapter: proposer,
					session: await proposer.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: baselineProposer,
					legacyToolPolicyInput: legacyToolPolicy,
				},
				challenger: {
					adapter: challenger,
					session: await challenger.startSession({
						profile: "test",
						workingDirectory: "/tmp",
					}),
					baselinePolicy: compilePolicy({
						preset: "guarded",
						role: "challenger",
					}),
				},
			};

			await runDebate(
				{
					...debateConfig,
					executionModes: {
						roleModes: { proposer: "guarded" },
						turnOverrides: { "p-1": "research" },
					},
				},
				adapters,
			);

			expect(proposerTurns).toHaveLength(1);
			expect(proposerTurns[0]?.policy).toBeDefined();
			expect(proposerTurns[0]?.policy?.preset).toBe("research");
			expect(proposerTurns[0]?.policy?.capabilities.filesystem).toBe("read");
			expect(
				proposerTurns[0]?.policy?.capabilities.legacyToolOverrides?.allow,
			).toEqual(["Read"]);
			expect(
				proposerTurns[0]?.policy?.capabilities.legacyToolOverrides?.deny,
			).toEqual(["WebFetch"]);
			expect(proposerTurns[0]?.policy).not.toBe(baselineProposer);

			expect(baselineProposer.preset).toBe("guarded");
			expect(baselineProposer.capabilities.filesystem).toBe("write");
			expect(
				adapters.proposer.baselinePolicy?.capabilities.legacyToolOverrides
					?.allow,
			).toEqual(["Read"]);
		});
	});
});
