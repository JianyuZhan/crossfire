import { describe, expect, it } from "vitest";
import { DebateDirector } from "../../src/director/debate-director.js";
import { DEFAULT_DIRECTOR_CONFIG } from "../../src/director/types.js";
import type { DebateConfig, DebateState } from "../../src/types.js";

const config: DebateConfig = {
  topic: "Test",
  maxRounds: 10,
  judgeEveryNRounds: 3,
  convergenceThreshold: 0.3,
};

function makeState(overrides: Partial<DebateState> = {}): DebateState {
  return {
    config,
    phase: "proposer-turn",
    currentRound: 1,
    turns: [],
    convergence: {
      converged: false,
      stanceDelta: 1.0,
      mutualConcessions: 0,
      bothWantToConclude: false,
    },
    ...overrides,
  };
}

describe("DebateDirector", () => {
  it("returns continue when no signals detected", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    const state = makeState({ currentRound: 1 });
    const action = director.evaluate(state);
    expect(action.type).toBe("continue");
  });

  it("returns trigger-judge on convergence (not immediate end-debate)", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    const state = makeState({
      currentRound: 3,
      convergence: {
        converged: true,
        stanceDelta: 0.1,
        mutualConcessions: 2,
        bothWantToConclude: true,
      },
    });
    const action = director.evaluate(state);
    expect(action.type).toBe("trigger-judge");
    if (action.type === "trigger-judge") {
      expect(action.reason).toBe("convergence");
    }
  });

  it("returns trigger-judge on stagnation", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    const turns = [
      {
        roundNumber: 1,
        role: "proposer" as const,
        content: "A",
        meta: {
          stance: "agree" as const,
          confidence: 0.8,
          keyPoints: ["p1"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 1,
        role: "challenger" as const,
        content: "B",
        meta: {
          stance: "disagree" as const,
          confidence: 0.7,
          keyPoints: ["c1"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "proposer" as const,
        content: "A2",
        meta: {
          stance: "agree" as const,
          confidence: 0.85,
          keyPoints: ["p2"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "challenger" as const,
        content: "B2",
        meta: {
          stance: "disagree" as const,
          confidence: 0.65,
          keyPoints: ["c2"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "proposer" as const,
        content: "A3",
        meta: {
          stance: "agree" as const,
          confidence: 0.9,
          keyPoints: ["p3"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "challenger" as const,
        content: "B3",
        meta: {
          stance: "disagree" as const,
          confidence: 0.62,
          keyPoints: ["c3"],
          concessions: [],
          wantsToConclude: false,
        },
      },
    ];
    const state = makeState({ currentRound: 3, turns });
    const action = director.evaluate(state);
    expect(action.type).toBe("trigger-judge");
  });

  it("returns inject-guidance for first-time degradation", () => {
    // Use higher maxRounds so round 3 isn't a scheduled judge trigger
    const customConfig = { ...DEFAULT_DIRECTOR_CONFIG, minJudgeRound: 5 };
    const director = new DebateDirector(customConfig);
    const sharedPoints = [
      "HA is critical",
      "contracts must bind",
      "procurement inertia",
    ];
    const turns = [
      {
        roundNumber: 1,
        role: "challenger" as const,
        content: "B1",
        meta: {
          stance: "disagree" as const,
          confidence: 0.7,
          keyPoints: sharedPoints,
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "challenger" as const,
        content: "B2",
        meta: {
          stance: "disagree" as const,
          confidence: 0.65,
          keyPoints: sharedPoints,
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "challenger" as const,
        content: "B3",
        meta: {
          stance: "disagree" as const,
          confidence: 0.62,
          keyPoints: sharedPoints,
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 1,
        role: "proposer" as const,
        content: "A1",
        meta: {
          stance: "strongly_agree" as const,
          confidence: 0.8,
          keyPoints: ["x"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "proposer" as const,
        content: "A2",
        meta: {
          stance: "agree" as const,
          confidence: 0.85,
          keyPoints: ["y"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "proposer" as const,
        content: "A3",
        meta: {
          stance: "neutral" as const,
          confidence: 0.9,
          keyPoints: ["z"],
          concessions: [],
          wantsToConclude: false,
        },
      },
    ];
    const state = makeState({ currentRound: 3, turns });
    const action = director.evaluate(state);
    // First degradation detection -> inject-guidance (not trigger-judge yet)
    expect(action.type).toBe("inject-guidance");
    if (action.type === "inject-guidance") {
      expect(action.target).toBe("challenger");
      expect(action.source).toBe("director");
    }
  });

  it("stores and returns guidance via getGuidance()", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    expect(director.getGuidance("proposer")).toBeUndefined();
    director.storeGuidance(
      "proposer",
      "Focus on new evidence",
      "normal",
      "user",
    );
    const guidance = director.getGuidance("proposer");
    expect(guidance).toContain("Focus on new evidence");
  });

  it("getGuidance() consumes guidance (one-shot)", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    director.storeGuidance("proposer", "test", "normal", "user");
    director.getGuidance("proposer");
    expect(director.getGuidance("proposer")).toBeUndefined();
  });

  it("action priority: end-debate wins over trigger-judge", () => {
    // Use stagnationLimit=1 so we can trigger end-debate quickly
    const customConfig = {
      ...DEFAULT_DIRECTOR_CONFIG,
      stagnationLimit: 1,
    };
    const director = new DebateDirector(customConfig);
    // Need 2 judge interventions for stagnation-limit end-debate
    director.recordJudgeIntervention();
    director.recordJudgeIntervention();

    // Stagnation-producing turns: frozen stances across rounds
    const stagnantTurns = [
      {
        roundNumber: 1,
        role: "proposer" as const,
        content: "A",
        meta: {
          stance: "agree" as const,
          confidence: 0.9,
          keyPoints: ["p"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 1,
        role: "challenger" as const,
        content: "B",
        meta: {
          stance: "disagree" as const,
          confidence: 0.7,
          keyPoints: ["c"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "proposer" as const,
        content: "A2",
        meta: {
          stance: "agree" as const,
          confidence: 0.9,
          keyPoints: ["p"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 2,
        role: "challenger" as const,
        content: "B2",
        meta: {
          stance: "disagree" as const,
          confidence: 0.7,
          keyPoints: ["c"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "proposer" as const,
        content: "A3",
        meta: {
          stance: "agree" as const,
          confidence: 0.9,
          keyPoints: ["p"],
          concessions: [],
          wantsToConclude: false,
        },
      },
      {
        roundNumber: 3,
        role: "challenger" as const,
        content: "B3",
        meta: {
          stance: "disagree" as const,
          confidence: 0.7,
          keyPoints: ["c"],
          concessions: [],
          wantsToConclude: false,
        },
      },
    ];

    // First evaluate to build stagnation counter
    director.evaluate(makeState({ currentRound: 3, turns: stagnantTurns }));

    // Second evaluate with convergence=true: both end-debate (stagnation-limit)
    // and trigger-judge (convergence) are candidates; end-debate should win
    const state = makeState({
      currentRound: 3,
      convergence: {
        converged: true,
        stanceDelta: 0.2,
        mutualConcessions: 3,
        bothWantToConclude: true,
      },
      turns: stagnantTurns,
    });
    const action = director.evaluate(state);
    expect(action.type).toBe("end-debate");
  });

  it("lastSignals() returns signals from most recent evaluate()", () => {
    const director = new DebateDirector(DEFAULT_DIRECTOR_CONFIG);
    const state = makeState({ currentRound: 1 });
    director.evaluate(state);
    expect(director.lastSignals()).toEqual([]);
  });
});
