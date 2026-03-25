import type { DebateRole, DebateState } from "../types.js";
import { evaluateClarification } from "./clarification-policy.js";
import { detectDegradation } from "./degradation-detector.js";
import { shouldTriggerJudge } from "./judge-policy.js";
import { detectStagnation } from "./stagnation-detector.js";
import type {
	DirectorAction,
	DirectorConfig,
	DirectorSignal,
	PendingGuidance,
} from "./types.js";
import { ACTION_PRIORITY } from "./types.js";

export class DebateDirector {
	private config: DirectorConfig;
	private pendingGuidance: Map<DebateRole, PendingGuidance> = new Map();
	private signals: DirectorSignal[] = [];
	private degradationGuidanceCount = 0;
	private judgeInterventionCount = 0;
	private stagnationRounds = 0;

	constructor(config: DirectorConfig) {
		this.config = config;
	}

	evaluate(state: DebateState): DirectorAction {
		this.signals = [];
		const candidates: DirectorAction[] = [];

		// 1. Check convergence — trigger judge first; only end if judge agrees (or no judge)
		if (state.convergence.converged) {
			candidates.push({ type: "trigger-judge", reason: "convergence" });
		}

		// 2. Detect stagnation
		const stagnation = detectStagnation(state, this.config.stagnationThreshold);
		this.signals.push(...stagnation);

		if (stagnation.length > 0) {
			this.stagnationRounds++;
			if (
				this.stagnationRounds >= this.config.stagnationLimit &&
				this.judgeInterventionCount >= 2
			) {
				candidates.push({ type: "end-debate", reason: "stagnation-limit" });
			}
		} else {
			this.stagnationRounds = 0;
		}

		// 3. Detect degradation
		const degradation = detectDegradation(
			state,
			this.config.degradationOverlapThreshold,
			this.config.degradationRoundsThreshold + 1,
		);
		this.signals.push(...degradation);

		// First degradation -> inject-guidance; subsequent -> escalate to Judge
		if (degradation.length > 0 && this.degradationGuidanceCount === 0) {
			const target = degradation[0].role;
			candidates.push({
				type: "inject-guidance",
				target,
				text: buildDegradationGuidance(degradation[0]),
				source: "director",
			});
			this.degradationGuidanceCount++;
		}

		// 4. Check agent request_intervention
		const lastTurns = getLastRoundTurns(state);
		for (const turn of lastTurns) {
			if (turn.meta?.requestIntervention) {
				const req = turn.meta.requestIntervention;
				const result = evaluateClarification({
					type: req.type,
					question: req.question,
				});
				if (result.allowed) {
					candidates.push({
						type: "trigger-judge",
						reason: "agent-request",
						agentQuestion: { source: turn.role, question: req.question },
					});
				}
			}
		}

		// 5. Check Judge policy (scheduled, stagnation, degradation triggers)
		const judgeTrigger = shouldTriggerJudge(
			state,
			this.config,
			stagnation,
			degradation,
			this.degradationGuidanceCount,
		);
		if (judgeTrigger) {
			candidates.push({ type: "trigger-judge", reason: judgeTrigger.reason });
		}

		// 6. Select highest-priority action
		if (candidates.length === 0) {
			return { type: "continue" };
		}

		candidates.sort(
			(a, b) => ACTION_PRIORITY[b.type] - ACTION_PRIORITY[a.type],
		);
		return candidates[0];
	}

	getGuidance(role: DebateRole): string | undefined {
		const guidance = this.pendingGuidance.get(role);
		if (guidance) {
			this.pendingGuidance.delete(role);
			if (guidance.priority === "high") {
				return `!! USER DIRECTIVE (priority: high):\n${guidance.text}\nYou MUST address this directive before continuing your argument.`;
			}
			return guidance.text;
		}
		return undefined;
	}

	storeGuidance(
		target: DebateRole,
		text: string,
		priority: "normal" | "high" = "normal",
		source: "director" | "user" = "director",
	): void {
		this.pendingGuidance.set(target, { target, text, priority, source });
	}

	lastSignals(): DirectorSignal[] {
		return [...this.signals];
	}

	recordJudgeIntervention(): void {
		this.judgeInterventionCount++;
	}

	/** Reset stagnation counter — call when judge overrides stagnation (shouldContinue=true) */
	resetStagnation(): void {
		this.stagnationRounds = 0;
	}
}

function getLastRoundTurns(state: DebateState) {
	const maxRound = state.currentRound;
	return state.turns.filter((t) => t.roundNumber === maxRound);
}

function buildDegradationGuidance(signal: DirectorSignal): string {
	return `Your recent arguments overlap significantly with previous rounds (${((signal as { overlapScore: number }).overlapScore * 100).toFixed(0)}% repetition). You MUST either: (a) introduce genuinely new evidence or perspectives, (b) directly address specific counterpoints you haven't yet responded to, or (c) acknowledge consensus and propose to conclude.`;
}
