import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { MetricsBar } from "../src/components/metrics-bar.js";
import type { MetricsState } from "../src/state/types.js";

function makeMetrics(overrides: Partial<MetricsState> = {}): MetricsState {
	return {
		currentRound: 1,
		maxRounds: 5,
		convergencePercent: 0,
		stanceDelta: 1.0,
		mutualConcessions: 0,
		bothWantToConclude: false,
		totalTokens: 0,
		proposerUsage: { tokens: 0, costUsd: 0 },
		challengerUsage: { tokens: 0, costUsd: 0 },
		...overrides,
	};
}

describe("MetricsBar", () => {
	it("renders per-agent token info", () => {
		const metrics = makeMetrics({
			convergencePercent: 35,
			proposerUsage: { tokens: 6200, costUsd: 0 },
			challengerUsage: { tokens: 3100, costUsd: 0 },
			judgeScore: { proposer: 7, challenger: 5 },
		});
		const { lastFrame } = render(<MetricsBar state={metrics} />);
		const output = lastFrame();
		expect(output).toContain("Proposer");
		expect(output).toContain("6.2k");
		expect(output).toContain("Challenger");
		expect(output).toContain("3.1k");
		expect(output).toContain("35");
		expect(output).not.toContain("$");
	});

	it("shows zero tokens when no usage", () => {
		const metrics = makeMetrics();
		const { lastFrame } = render(<MetricsBar state={metrics} />);
		expect(lastFrame()).toContain("0 tokens");
		expect(lastFrame()).not.toContain("$");
	});
});
