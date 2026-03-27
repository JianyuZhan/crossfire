import {
	type AnyEvent,
	type EvolvingPlan,
	type JudgeVerdict,
	type RoundSignals,
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
	private seenKeyPoints = new Set<string>();
	private processedRounds = new Set<number>();

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

				// Update judgeImpact for this round's RoundSignals
				const signals = [...(this.plan.roundSignals ?? [])];
				const idx = signals.findIndex((s) => s.roundNumber === e.roundNumber);
				if (idx >= 0) {
					const prevJudge = this.plan.judgeNotes.at(-2);
					const spread = e.verdict.score
						? Math.abs(e.verdict.score.proposer - e.verdict.score.challenger)
						: 0;
					signals[idx] = {
						...signals[idx],
						judgeImpact: {
							hasVerdict: true,
							weighted: spread >= 0.3,
							directionChange: prevJudge
								? prevJudge.leading !== e.verdict.leading
								: false,
						},
					};
					this.plan = { ...this.plan, roundSignals: signals };
				}
			}
		}
	}

	private shallowSetEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		const setA = new Set(a);
		for (const item of b) {
			if (!setA.has(item)) return false;
		}
		return true;
	}

	private processRound(roundNumber: number): void {
		// Detect reprocess — if this round was already processed, do a full rebuild
		if (this.processedRounds.has(roundNumber)) {
			this.rebuildRoundDerivedState();
			return;
		}
		this.processedRounds.add(roundNumber);

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

		// Snapshot plan BEFORE update to compute deltas
		const planBefore = this.plan;
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

		// --- RoundSignals computation ---

		// Historical dedup for newClaimCount
		const currentClaims = [
			...new Set(
				fallback.newArguments.map((a) => a.argument.trim().toLowerCase()),
			),
		];
		const newClaimCount = currentClaims.filter(
			(c) => !this.seenKeyPoints.has(c),
		).length;
		for (const c of currentClaims) this.seenKeyPoints.add(c);

		// Concession is strictly from meta.concessions, NOT consensus
		const hasConcession =
			(proposerTurn?.meta?.concessions?.length ?? 0) > 0 ||
			(challengerTurn?.meta?.concessions?.length ?? 0) > 0;

		// Shallow set diff for consensus and risks
		const consensusDelta = !this.shallowSetEqual(
			planBefore.consensus,
			this.plan.consensus,
		);
		const riskDelta = !this.shallowSetEqual(
			planBefore.risks.map((r) => `${r.risk}|${r.severity}|${r.round}`),
			this.plan.risks.map((r) => `${r.risk}|${r.severity}|${r.round}`),
		);

		const signals: RoundSignals = {
			roundNumber,
			newClaimCount,
			hasConcession,
			consensusDelta,
			riskDelta,
			judgeImpact: {
				hasVerdict: false,
				weighted: false,
				directionChange: false,
			},
		};

		// Upsert roundSignals (unique by roundNumber)
		const existingRS = (this.plan.roundSignals ?? []).filter(
			(s) => s.roundNumber !== roundNumber,
		);
		this.plan = {
			...this.plan,
			roundSignals: [...existingRS, signals].sort(
				(a, b) => a.roundNumber - b.roundNumber,
			),
		};
	}

	private rebuildRoundDerivedState(): void {
		// Reset all order-sensitive state
		this.seenKeyPoints = new Set<string>();
		this.processedRounds = new Set<number>();

		// Start from a clean plan preserving only the global state from updatePlan()
		let rebuiltPlan = emptyPlan();
		const state = projectState(this.events);

		// Collect all unique round numbers from events that have been completed
		const completedRounds = new Set<number>();
		for (const event of this.events) {
			if (event.kind === "round.completed") {
				const e = event as { roundNumber: number; speaker: string };
				if (e.speaker === "challenger") {
					completedRounds.add(e.roundNumber);
				}
			}
		}

		// Process in ascending order
		const sortedRounds = [...completedRounds].sort((a, b) => a - b);

		for (const roundNumber of sortedRounds) {
			// Find turns for this round (use reverse for latest)
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

			// Snapshot before update
			const planBefore = rebuiltPlan;
			rebuiltPlan = updatePlan(rebuiltPlan, fallback);

			// Upsert roundAnalyses
			const existingRA = (rebuiltPlan.roundAnalyses ?? []).filter(
				(a) => a.roundNumber !== roundNumber,
			);
			rebuiltPlan = {
				...rebuiltPlan,
				roundAnalyses: [...existingRA, fallback].sort(
					(a, b) => a.roundNumber - b.roundNumber,
				),
			};

			// Degraded status
			const isDegraded = !proposerTurn?.meta && !challengerTurn?.meta;
			const currentDegraded = rebuiltPlan.degradedRounds.filter(
				(r) => r !== roundNumber,
			);
			rebuiltPlan = {
				...rebuiltPlan,
				degradedRounds: isDegraded
					? [...currentDegraded, roundNumber].sort((a, b) => a - b)
					: currentDegraded,
			};

			// RoundSignals computation (same as processRound)
			const currentClaims = [
				...new Set(
					fallback.newArguments.map((a) => a.argument.trim().toLowerCase()),
				),
			];
			const newClaimCount = currentClaims.filter(
				(c) => !this.seenKeyPoints.has(c),
			).length;
			for (const c of currentClaims) this.seenKeyPoints.add(c);

			const hasConcession =
				(proposerTurn?.meta?.concessions?.length ?? 0) > 0 ||
				(challengerTurn?.meta?.concessions?.length ?? 0) > 0;

			const consensusDelta = !this.shallowSetEqual(
				planBefore.consensus,
				rebuiltPlan.consensus,
			);
			const riskDelta = !this.shallowSetEqual(
				planBefore.risks.map((r) => `${r.risk}|${r.severity}|${r.round}`),
				rebuiltPlan.risks.map((r) => `${r.risk}|${r.severity}|${r.round}`),
			);

			const signals: RoundSignals = {
				roundNumber,
				newClaimCount,
				hasConcession,
				consensusDelta,
				riskDelta,
				judgeImpact: {
					hasVerdict: false,
					weighted: false,
					directionChange: false,
				},
			};

			const existingRS = (rebuiltPlan.roundSignals ?? []).filter(
				(s) => s.roundNumber !== roundNumber,
			);
			rebuiltPlan = {
				...rebuiltPlan,
				roundSignals: [...existingRS, signals].sort(
					(a, b) => a.roundNumber - b.roundNumber,
				),
			};

			this.processedRounds.add(roundNumber);
		}

		// Re-apply judge verdicts in order
		const judgeEvents: Array<{
			roundNumber: number;
			verdict: JudgeVerdict;
		}> = [];
		for (const event of this.events) {
			if (event.kind === "judge.completed") {
				const e = event as {
					roundNumber: number;
					verdict?: JudgeVerdict;
				};
				if (e.verdict) {
					judgeEvents.push({
						roundNumber: e.roundNumber,
						verdict: e.verdict,
					});
				}
			}
		}
		for (const je of judgeEvents) {
			rebuiltPlan = updatePlanWithJudge(
				rebuiltPlan,
				je.verdict,
				je.roundNumber,
			);

			// Patch judgeImpact
			const signals = [...(rebuiltPlan.roundSignals ?? [])];
			const idx = signals.findIndex((s) => s.roundNumber === je.roundNumber);
			if (idx >= 0) {
				const prevJudge = rebuiltPlan.judgeNotes.at(-2);
				const spread = je.verdict.score
					? Math.abs(je.verdict.score.proposer - je.verdict.score.challenger)
					: 0;
				signals[idx] = {
					...signals[idx],
					judgeImpact: {
						hasVerdict: true,
						weighted: spread >= 0.3,
						directionChange: prevJudge
							? prevJudge.leading !== je.verdict.leading
							: false,
					},
				};
				rebuiltPlan = { ...rebuiltPlan, roundSignals: signals };
			}
		}

		this.plan = rebuiltPlan;
	}
}
