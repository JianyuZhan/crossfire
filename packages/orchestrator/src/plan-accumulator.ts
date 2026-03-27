import {
	type AnyEvent,
	type EvolvingPlan,
	type JudgeVerdict,
	buildFallbackRoundAnalysis,
	emptyPlan,
	projectState,
	updatePlan,
	updatePlanWithJudge,
} from "@crossfire/orchestrator-core";
import type { DebateEventBus } from "./event-bus.js";

export class PlanAccumulator {
	private plan: EvolvingPlan = emptyPlan();
	private frozen = false;
	private events: AnyEvent[] = [];

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
		await new Promise<void>((r) => queueMicrotask(r));
		this.frozen = true;
	}

	private handleEvent(event: AnyEvent): void {
		if (event.kind === "round.completed") {
			const e = event as { roundNumber: number; speaker: string };
			if (e.speaker === "challenger") {
				queueMicrotask(() => {
					if (!this.frozen) this.processRound(e.roundNumber);
				});
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
		// Use reverse search to find the latest turn for this round (handles reprocess)
		const reversed = [...state.turns].reverse();
		const proposerTurn = reversed.find(
			(t) => t.roundNumber === roundNumber && t.role === "proposer",
		);
		const challengerTurn = reversed.find(
			(t) => t.roundNumber === roundNumber && t.role === "challenger",
		);

		const fallback = buildFallbackRoundAnalysis(
			roundNumber,
			proposerTurn?.meta,
			challengerTurn?.meta,
		);
		this.plan = updatePlan(this.plan, fallback);

		// Upsert roundAnalyses by roundNumber, keeping ascending order
		const existing = this.plan.roundAnalyses ?? [];
		const filtered = existing.filter((a) => a.roundNumber !== roundNumber);
		const updated = [...filtered, fallback].sort(
			(a, b) => a.roundNumber - b.roundNumber,
		);
		this.plan = { ...this.plan, roundAnalyses: updated };

		// Determine degraded status: degraded if neither side provided meta
		const isDegraded = !proposerTurn?.meta && !challengerTurn?.meta;
		const currentDegraded = this.plan.degradedRounds.filter(
			(r) => r !== roundNumber,
		);
		this.plan = {
			...this.plan,
			degradedRounds: isDegraded
				? [...currentDegraded, roundNumber].sort((a, b) => a - b)
				: currentDegraded,
		};
	}
}
