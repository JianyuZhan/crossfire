import {
	type AnyEvent,
	type DebateState,
	type DebateTurn,
	type EvolvingPlan,
	type JudgeVerdict,
	type RoundAnalysis,
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
				this.plan = applyJudgeVerdict(this.plan, e.verdict, e.roundNumber);
			}
		}
	}

	private processRound(roundNumber: number): void {
		// Detect reprocess — if this round was already processed, do a full rebuild
		if (this.processedRounds.has(roundNumber)) {
			this.rebuildRoundDerivedState();
			return;
		}
		this.processedRounds.add(roundNumber);

		const state = projectState(this.events);
		const { proposerTurn, challengerTurn } = findLatestTurns(
			state,
			roundNumber,
		);

		const planBefore = this.plan;
		this.plan = this.applyRoundToPlan(
			this.plan,
			roundNumber,
			proposerTurn,
			challengerTurn,
			planBefore,
		);
	}

	private rebuildRoundDerivedState(): void {
		this.seenKeyPoints = new Set<string>();
		this.processedRounds = new Set<number>();

		let rebuiltPlan = emptyPlan();
		const state = projectState(this.events);

		// Collect completed rounds from events
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
		for (const roundNumber of [...completedRounds].sort((a, b) => a - b)) {
			const { proposerTurn, challengerTurn } = findLatestTurns(
				state,
				roundNumber,
			);
			const planBefore = rebuiltPlan;
			rebuiltPlan = this.applyRoundToPlan(
				rebuiltPlan,
				roundNumber,
				proposerTurn,
				challengerTurn,
				planBefore,
			);
			this.processedRounds.add(roundNumber);
		}

		// Re-apply judge verdicts in order
		for (const event of this.events) {
			if (event.kind === "judge.completed") {
				const e = event as {
					roundNumber: number;
					verdict?: JudgeVerdict;
				};
				if (e.verdict) {
					rebuiltPlan = applyJudgeVerdict(
						rebuiltPlan,
						e.verdict,
						e.roundNumber,
					);
				}
			}
		}

		this.plan = rebuiltPlan;
	}

	/**
	 * Apply a single round's analysis, degraded status, and signals to a plan.
	 * Shared between processRound (incremental) and rebuildRoundDerivedState (full rebuild).
	 */
	private applyRoundToPlan(
		plan: EvolvingPlan,
		roundNumber: number,
		proposerTurn: DebateTurn | undefined,
		challengerTurn: DebateTurn | undefined,
		planBefore: EvolvingPlan,
	): EvolvingPlan {
		const analysis = buildFallbackRoundAnalysis(
			roundNumber,
			proposerTurn?.meta,
			challengerTurn?.meta,
		);

		let updated = updatePlan(plan, analysis);
		updated = upsertRoundAnalysis(updated, roundNumber, analysis);
		updated = updateDegradedRounds(
			updated,
			roundNumber,
			!proposerTurn?.meta && !challengerTurn?.meta,
		);
		const signals = this.computeRoundSignals(
			roundNumber,
			analysis,
			proposerTurn,
			challengerTurn,
			planBefore,
			updated,
		);
		return upsertByRoundNumber(updated, "roundSignals", signals);
	}

	/**
	 * Compute RoundSignals for a round, tracking new claims across the
	 * lifetime of the accumulator via seenKeyPoints.
	 */
	private computeRoundSignals(
		roundNumber: number,
		analysis: RoundAnalysis,
		proposerTurn: DebateTurn | undefined,
		challengerTurn: DebateTurn | undefined,
		planBefore: EvolvingPlan,
		planAfter: EvolvingPlan,
	): RoundSignals {
		const currentClaims = [
			...new Set(
				analysis.newArguments.map((a) => a.argument.trim().toLowerCase()),
			),
		];
		const newClaimCount = currentClaims.filter(
			(c) => !this.seenKeyPoints.has(c),
		).length;
		for (const c of currentClaims) this.seenKeyPoints.add(c);

		const hasConcession =
			(proposerTurn?.meta?.concessions?.length ?? 0) > 0 ||
			(challengerTurn?.meta?.concessions?.length ?? 0) > 0;

		const consensusDelta = !shallowSetEqual(
			planBefore.consensus,
			planAfter.consensus,
		);
		const riskDelta = !shallowSetEqual(
			planBefore.risks.map(riskKey),
			planAfter.risks.map(riskKey),
		);

		return {
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
	}
}

// --- Pure helper functions ---

function findLatestTurns(
	state: DebateState,
	roundNumber: number,
): {
	proposerTurn: DebateTurn | undefined;
	challengerTurn: DebateTurn | undefined;
} {
	const reversed = [...state.turns].reverse();
	return {
		proposerTurn: reversed.find(
			(t) => t.roundNumber === roundNumber && t.role === "proposer",
		),
		challengerTurn: reversed.find(
			(t) => t.roundNumber === roundNumber && t.role === "challenger",
		),
	};
}

function riskKey(r: { risk: string; severity: string; round: number }): string {
	return `${r.risk}|${r.severity}|${r.round}`;
}

function shallowSetEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const setA = new Set(a);
	for (const item of b) {
		if (!setA.has(item)) return false;
	}
	return true;
}

/** Upsert roundAnalyses by roundNumber, keeping ascending order */
function upsertRoundAnalysis(
	plan: EvolvingPlan,
	roundNumber: number,
	analysis: RoundAnalysis,
): EvolvingPlan {
	const existing = (plan.roundAnalyses ?? []).filter(
		(a) => a.roundNumber !== roundNumber,
	);
	return {
		...plan,
		roundAnalyses: [...existing, analysis].sort(
			(a, b) => a.roundNumber - b.roundNumber,
		),
	};
}

/** Update degradedRounds list based on whether a round is degraded */
function updateDegradedRounds(
	plan: EvolvingPlan,
	roundNumber: number,
	isDegraded: boolean,
): EvolvingPlan {
	const filtered = plan.degradedRounds.filter((r) => r !== roundNumber);
	return {
		...plan,
		degradedRounds: isDegraded
			? [...filtered, roundNumber].sort((a, b) => a - b)
			: filtered,
	};
}

/** Upsert an item into a plan array field keyed by roundNumber */
function upsertByRoundNumber(
	plan: EvolvingPlan,
	field: "roundSignals",
	item: RoundSignals,
): EvolvingPlan {
	const existing = (plan[field] ?? []).filter(
		(s) => s.roundNumber !== item.roundNumber,
	);
	return {
		...plan,
		[field]: [...existing, item].sort((a, b) => a.roundNumber - b.roundNumber),
	};
}

/** Apply a judge verdict to the plan and patch the corresponding RoundSignals */
function applyJudgeVerdict(
	plan: EvolvingPlan,
	verdict: JudgeVerdict,
	roundNumber: number,
): EvolvingPlan {
	let updated = updatePlanWithJudge(plan, verdict, roundNumber);

	const signals = [...(updated.roundSignals ?? [])];
	const idx = signals.findIndex((s) => s.roundNumber === roundNumber);
	if (idx >= 0) {
		const prevJudge = updated.judgeNotes.at(-2);
		const spread = verdict.score
			? Math.abs(verdict.score.proposer - verdict.score.challenger)
			: 0;
		signals[idx] = {
			...signals[idx],
			judgeImpact: {
				hasVerdict: true,
				weighted: spread >= 0.3,
				directionChange: prevJudge
					? prevJudge.leading !== verdict.leading
					: false,
			},
		};
		updated = { ...updated, roundSignals: signals };
	}

	return updated;
}
