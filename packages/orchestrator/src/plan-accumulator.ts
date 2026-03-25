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
		this.plan = updatePlan(this.plan, fallback);
		this.plan = {
			...this.plan,
			degradedRounds: [...this.plan.degradedRounds, roundNumber],
		};
	}
}
