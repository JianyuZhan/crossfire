import {
	type AnyEvent,
	type EvolvingPlan,
	type JudgeVerdict,
	type RoundAnalysis,
	buildFallbackRoundAnalysis,
	emptyPlan,
	projectState,
	replayPlan,
	updatePlan,
	updatePlanWithJudge,
} from "@crossfire/orchestrator-core";
import type { DebateEventBus } from "./event-bus.js";
import {
	type SynthesizerConfig,
	buildRoundSynthesisPrompt,
	callSynthesizerLLM,
	parseRoundAnalysisResponse,
} from "./round-synthesizer.js";

export class PlanAccumulator {
	private config: SynthesizerConfig;
	private plan: EvolvingPlan = emptyPlan();
	private roundAnalyses: Map<number, RoundAnalysis> = new Map();
	private frozen = false;
	private inflightTasks: Map<number, Promise<void>> = new Map();
	private events: AnyEvent[] = [];

	constructor(config: SynthesizerConfig) {
		this.config = config;
	}

	subscribe(bus: DebateEventBus): () => void {
		return bus.subscribe((event: AnyEvent) => {
			if (this.frozen) return;
			this.events.push(event);
			this.handleEvent(event);
		});
	}

	snapshot(): EvolvingPlan {
		return this.plan;
	}

	async flush(): Promise<void> {
		if (this.frozen) return;
		const timeout = this.config.flushTimeoutMs ?? 15000;
		const pending = [...this.inflightTasks.values()];
		if (pending.length > 0) {
			await Promise.race([
				Promise.allSettled(pending),
				new Promise<void>((r) => setTimeout(r, timeout)),
			]);
		}
		this.frozen = true;
	}

	private handleEvent(event: AnyEvent): void {
		if (event.kind === "round.completed") {
			const e = event as { roundNumber: number; speaker: string };
			if (e.speaker === "challenger") {
				this.processRound(e.roundNumber);
			}
		}

		if (event.kind === "judge.completed") {
			const e = event as { roundNumber: number; verdict?: JudgeVerdict };
			if (e.verdict) {
				this.plan = updatePlanWithJudge(this.plan, e.verdict, e.roundNumber);
			}
		}
	}

	private processRound(roundNumber: number): void {
		const state = projectState(this.events);
		const proposerTurn = state.turns.find(
			(t) => t.roundNumber === roundNumber && t.role === "proposer",
		);
		const challengerTurn = state.turns.find(
			(t) => t.roundNumber === roundNumber && t.role === "challenger",
		);

		const fallback = buildFallbackRoundAnalysis(
			roundNumber,
			proposerTurn?.meta,
			challengerTurn?.meta,
		);
		this.roundAnalyses.set(roundNumber, fallback);
		this.plan = updatePlan(this.plan, fallback);
		this.plan = {
			...this.plan,
			degradedRounds: [...this.plan.degradedRounds, roundNumber],
		};

		if (this.config.enabled && this.config.apiKey) {
			const task = this.runAsyncSynthesis(
				roundNumber,
				proposerTurn?.content ?? "",
				challengerTurn?.content ?? "",
			);
			this.inflightTasks.set(roundNumber, task);
		}
	}

	private async runAsyncSynthesis(
		roundNumber: number,
		proposerText: string,
		challengerText: string,
	): Promise<void> {
		try {
			const prevAnalysis = this.roundAnalyses.get(roundNumber - 1);
			const prompt = buildRoundSynthesisPrompt({
				roundNumber,
				proposerText,
				challengerText,
				previousRoundSummary: prevAnalysis?.roundSummary,
				planSnapshot: {
					consensus: this.plan.consensus,
					unresolved: this.plan.unresolved,
				},
			});

			const response = await callSynthesizerLLM(prompt, this.config);

			if (this.frozen || !response) return;

			const analysis = parseRoundAnalysisResponse(response, roundNumber);
			if (!analysis) return;

			this.roundAnalyses.set(roundNumber, analysis);
			const allAnalyses = [...this.roundAnalyses.values()];
			this.plan = replayPlan(allAnalyses, this.plan.judgeNotes);
			this.plan = {
				...this.plan,
				degradedRounds: this.plan.degradedRounds.filter(
					(r) => r !== roundNumber,
				),
			};
		} catch {
			// Non-fatal — fallback stands
		} finally {
			this.inflightTasks.delete(roundNumber);
		}
	}
}
