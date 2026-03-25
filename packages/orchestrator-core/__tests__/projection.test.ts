import type { NormalizedEvent } from "@crossfire/adapter-core";
// packages/orchestrator-core/__tests__/projection.test.ts
import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "../src/orchestrator-events.js";
import { projectState } from "../src/projection.js";
import type { DebateConfig } from "../src/types.js";

type AnyEvent = NormalizedEvent | OrchestratorEvent;

const config: DebateConfig = {
	topic: "Test topic",
	maxRounds: 10,
	judgeEveryNRounds: 3,
	convergenceThreshold: 0.3,
};

describe("projectState", () => {
	it("returns idle state for empty events", () => {
		const state = projectState([]);
		expect(state.phase).toBe("idle");
		expect(state.currentRound).toBe(0);
		expect(state.turns).toHaveLength(0);
	});

	it("initializes from debate.started", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
		];
		const state = projectState(events);
		expect(state.config.topic).toBe("Test topic");
		expect(state.phase).toBe("idle");
		expect(state.currentRound).toBe(0);
	});

	it("sets phase on round.started", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
		];
		const state = projectState(events);
		expect(state.phase).toBe("proposer-turn");
		expect(state.currentRound).toBe(1);
	});

	it("aggregates message.final into turn content", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text: "I propose that...",
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state = projectState(events);
		expect(state.turns).toHaveLength(1);
		expect(state.turns[0].content).toBe("I propose that...");
		expect(state.turns[0].role).toBe("proposer");
		expect(state.turns[0].roundNumber).toBe(1);
	});

	it("extracts debate_meta from tool.call", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text: "My argument",
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
			{
				kind: "tool.call",
				toolUseId: "t1",
				toolName: "debate_meta",
				input: {
					stance: "agree",
					confidence: 0.8,
					key_points: ["Point A"],
				},
				timestamp: 1003,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state = projectState(events);
		expect(state.turns[0].meta).toBeDefined();
		expect(state.turns[0].meta?.stance).toBe("agree");
		expect(state.turns[0].meta?.confidence).toBe(0.8);
		expect(state.turns[0].meta?.keyPoints).toEqual(["Point A"]);
	});

	it("extracts judge_verdict from tool.call", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text: "Argument",
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
			{
				kind: "round.completed",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1003,
			},
			{ kind: "judge.started", roundNumber: 1, timestamp: 1004 },
			{
				kind: "tool.call",
				toolUseId: "j1",
				toolName: "judge_verdict",
				input: {
					leading: "proposer",
					score: { proposer: 7, challenger: 5 },
					reasoning: "Better evidence",
					should_continue: true,
				},
				timestamp: 1005,
				adapterId: "claude",
				adapterSessionId: "s2",
				turnId: "j-1",
			} satisfies NormalizedEvent,
			{
				kind: "judge.completed",
				roundNumber: 1,
				verdict: {
					leading: "proposer",
					score: { proposer: 7, challenger: 5 },
					reasoning: "Better evidence",
					shouldContinue: true,
				},
				timestamp: 1006,
			},
		];
		const state = projectState(events);
		expect(state.turns[0].judgeVerdict).toBeDefined();
		expect(state.turns[0].judgeVerdict?.leading).toBe("proposer");
	});

	it("extracts debate_meta from fenced JSON in message.final", () => {
		const text = `Here is my argument about the topic.

\`\`\`debate_meta
{"stance":"agree","confidence":0.85,"key_points":["Point A","Point B"],"concessions":["Concession 1"],"wants_to_conclude":false}
\`\`\``;
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text,
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state = projectState(events);
		expect(state.turns[0].meta).toBeDefined();
		expect(state.turns[0].meta?.stance).toBe("agree");
		expect(state.turns[0].meta?.confidence).toBe(0.85);
		expect(state.turns[0].meta?.keyPoints).toEqual(["Point A", "Point B"]);
		expect(state.turns[0].meta?.concessions).toEqual(["Concession 1"]);
	});

	it("extracts debate_meta from markdown prose format", () => {
		const text = `# My argument

Here is what I think about this topic.

---

**debate_meta 结构化总结：**

- **stance**: agree（modified proposal is viable）
- **confidence**: 0.80（more realistic after pressure test）
- **key_points**:
  1. API proxy layer is core to preventing bypass
  2. 1-yuan trial balances trust and anti-abuse
  3. Value-added reseller positioning creates long-term moat
  4. Contract protection ensures commission rights
- **concessions**:
  1. Technical isolation is not impenetrable for sophisticated clients
  2. Full-featured SaaS service list was too broad
  3. Compliance risk was a blind spot in first proposal
- **wants_to_conclude**: false`;
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text,
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state = projectState(events);
		expect(state.turns[0].meta).toBeDefined();
		expect(state.turns[0].meta?.stance).toBe("agree");
		expect(state.turns[0].meta?.confidence).toBe(0.8);
		expect(state.turns[0].meta?.keyPoints).toHaveLength(4);
		expect(state.turns[0].meta?.concessions).toHaveLength(3);
		expect(state.turns[0].meta?.wantsToConclude).toBe(false);
	});

	it("tool.call debate_meta takes precedence over fenced JSON", () => {
		const text = `Argument text.

\`\`\`debate_meta
{"stance":"disagree","confidence":0.5,"key_points":["Wrong"]}
\`\`\``;
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "tool.call",
				toolUseId: "t1",
				toolName: "debate_meta",
				input: {
					stance: "agree",
					confidence: 0.9,
					key_points: ["Correct"],
				},
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
			{
				kind: "message.final",
				text,
				role: "assistant",
				timestamp: 1003,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state = projectState(events);
		// tool.call meta should be used, not the fenced JSON
		expect(state.turns[0].meta?.stance).toBe("agree");
		expect(state.turns[0].meta?.confidence).toBe(0.9);
	});

	it("sets completed phase on debate.completed", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "debate.completed",
				reason: "max-rounds",
				timestamp: 2000,
			},
		];
		const state = projectState(events);
		expect(state.phase).toBe("completed");
		expect(state.terminationReason).toBe("max-rounds");
	});

	it("is deterministic — same events produce same state", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text: "Test",
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
		];
		const state1 = projectState(events);
		const state2 = projectState(events);
		expect(state1).toEqual(state2);
	});

	it("ignores unknown event kinds", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{ kind: "unknown.event" as any, timestamp: 1001 },
		];
		expect(() => projectState(events)).not.toThrow();
	});

	it("treats debate.resumed as a no-op", () => {
		const eventsWithoutResume: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1000 },
			{
				kind: "round.started",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1001,
			},
			{
				kind: "message.final",
				text: "Initial argument",
				role: "assistant",
				timestamp: 1002,
				adapterId: "claude",
				adapterSessionId: "s1",
				turnId: "p-1",
			} satisfies NormalizedEvent,
			{
				kind: "round.completed",
				roundNumber: 1,
				speaker: "proposer",
				timestamp: 1003,
			},
		];

		const eventsWithResume: AnyEvent[] = [
			...eventsWithoutResume,
			{ kind: "debate.resumed", timestamp: 1004 },
		];

		const stateWithoutResume = projectState(eventsWithoutResume);
		const stateWithResume = projectState(eventsWithResume);

		// State should be identical with or without debate.resumed - it's just a marker
		expect(stateWithResume).toEqual(stateWithoutResume);
	});
});

describe("new Director event kinds", () => {
	it("ignores user.inject events in projection", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1 },
			{
				kind: "user.inject",
				target: "proposer",
				text: "focus on X",
				priority: "normal",
				timestamp: 2,
			},
		];
		const state = projectState(events);
		expect(state.phase).toBe("idle");
		expect(state.turns).toHaveLength(0);
	});

	it("ignores director.action events in projection", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1 },
			{
				kind: "director.action",
				action: { type: "continue" },
				signals: [],
				timestamp: 2,
			},
		];
		const state = projectState(events);
		expect(state.phase).toBe("idle");
	});

	it("ignores clarification events in projection", () => {
		const events: AnyEvent[] = [
			{ kind: "debate.started", config, timestamp: 1 },
			{
				kind: "clarification.requested",
				source: "proposer",
				question: "Budget?",
				timestamp: 2,
			},
			{
				kind: "clarification.provided",
				answer: "$50k",
				answeredBy: "user",
				timestamp: 3,
			},
		];
		const state = projectState(events);
		expect(state.phase).toBe("idle");
	});
});
