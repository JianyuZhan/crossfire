import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { MetricsBar, metricsBarHeight } from "../src/components/metrics-bar.js";
import type { LiveAgentPanelState, MetricsState } from "../src/state/types.js";

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

function makePanel(
	overrides: Partial<LiveAgentPanelState> = {},
): LiveAgentPanelState {
	return {
		role: "proposer",
		status: "idle",
		thinkingText: "",
		narrationTexts: [],
		currentMessageText: "",
		tools: [],
		warnings: [],
		...overrides,
	};
}

describe("MetricsBar", () => {
	it("renders per-agent token info and convergence", () => {
		const metrics = makeMetrics({
			convergencePercent: 35,
			proposerUsage: {
				tokens: 6200,
				costUsd: 0,
				semantics: "session_delta_or_cached",
			} as any,
			challengerUsage: {
				tokens: 3100,
				costUsd: 0,
				semantics: "cumulative_thread_total",
			} as any,
			judgeVerdict: { shouldContinue: true, leading: "proposer" },
		});
		const { lastFrame } = render(<MetricsBar state={metrics} />);
		const output = lastFrame();
		expect(output).toContain("Proposer");
		expect(output).toContain("6.2k tokens");
		expect(output).toContain("session delta");
		expect(output).toContain("Challenger");
		expect(output).toContain("3.1k tokens");
		expect(output).toContain("thread cumulative");
		expect(output).toContain("35%");
		expect(output).toContain("Continue");
		expect(output).toContain("proposer leads");
	});

	it("shows zero tokens when no usage", () => {
		const metrics = makeMetrics();
		const { lastFrame } = render(<MetricsBar state={metrics} />);
		const output = lastFrame();
		expect(output).toContain("0 tokens");
		expect(output).toContain("Convergence");
	});

	it("keeps active tool status visible in the fixed bar", () => {
		const metrics = makeMetrics();
		const { lastFrame } = render(
			<MetricsBar
				state={metrics}
				livePanels={{
					proposer: makePanel({
						role: "proposer",
						status: "tool",
						executionMode: "research",
						tools: [
							{
								toolUseId: "t1",
								toolName: "WebFetch",
								inputSummary: "{}",
								status: "running",
								elapsedMs: 419100,
								expanded: true,
							},
							{
								toolUseId: "t2",
								toolName: "WebFetch",
								inputSummary: "{}",
								status: "succeeded",
								expanded: true,
							},
							{
								toolUseId: "t3",
								toolName: "WebFetch",
								inputSummary: "{}",
								status: "failed",
								resultSummary: "Request failed with status code 404",
								expanded: true,
							},
						],
					}),
					challenger: makePanel({
						role: "challenger",
						status: "idle",
					}),
				}}
			/>,
		);
		const output = lastFrame();
		const lines = output.split("\n");
		expect(output).toContain("Active:");
		expect(output).toContain("Proposer");
		expect(output).toContain("1 running");
		expect(output).toContain("active 419.1s");
		expect(output).toContain("recent failures: 404×1");
		expect(output).toContain("research");
		expect(lines[1]).toContain("Active:");
		expect(lines[1]).not.toContain("tokens");
	});

	it("metricsBarHeight returns 4", () => {
		expect(metricsBarHeight()).toBe(4);
	});
});
