import { join } from "node:path";
import { stripInternalBlocks } from "@crossfire/orchestrator-core";
import type {
	CollapsedRoundSummary,
	ContentChunk,
	RenderBlock,
	TuiRound,
	TuiState,
} from "../state/types.js";
import { buildPanelLines, screenLine } from "./line-buffer.js";
import {
	idleBlocks,
	liveStateToBlocks,
	snapshotToBlocks,
} from "./render-blocks.js";

export function shouldCollapse(
	round: TuiRound,
	allRounds: TuiRound[],
): boolean {
	if (round.userCollapsed !== undefined) return round.userCollapsed;
	return allRounds.some((r) => r.roundNumber > round.roundNumber);
}

function isCompleted(round: TuiRound): boolean {
	return !!round.proposer && !!round.challenger;
}

function findActiveRound(state: TuiState): TuiRound | undefined {
	if (state.rounds.length === 0) return undefined;
	const last = state.rounds[state.rounds.length - 1];
	if (!last.proposer || !last.challenger) return last;
	return undefined;
}

function buildCollapsedLines(round: TuiRound): CollapsedRoundSummary {
	const pText = (round.proposer?.messageText ?? "").replace(/\n/g, " ");
	const cText = (round.challenger?.messageText ?? "").replace(/\n/g, " ");
	return { proposerLine: pText, challengerLine: cText };
}

export function rebuildChunks(state: TuiState): ContentChunk[] {
	const chunks: ContentChunk[] = [];
	const completedRounds = state.rounds.filter(isCompleted);

	// 1. Completed rounds (each followed by its judge chunk if available)
	for (const round of completedRounds) {
		const collapsed = shouldCollapse(round, state.rounds);

		if (collapsed) {
			chunks.push({
				type: "round",
				roundNumber: round.roundNumber,
				maxRounds: state.metrics.maxRounds,
				active: false,
				collapsed: true,
				collapsedSummary: buildCollapsedLines(round),
				leftLines: [],
				rightLines: [],
				height: 0,
			});
		} else {
			const leftBlocks = snapshotToBlocks(
				round.proposer!,
				"proposer",
				state.proposer.agentType,
			);
			const rightBlocks = snapshotToBlocks(
				round.challenger!,
				"challenger",
				state.challenger.agentType,
			);
			chunks.push({
				type: "round",
				roundNumber: round.roundNumber,
				maxRounds: state.metrics.maxRounds,
				active: false,
				collapsed: false,
				leftBlocks,
				rightBlocks,
				leftLines: [],
				rightLines: [],
				height: 0,
			});
		}

		// Completed judge result for this round — always shown as separate chunk
		const jr = state.judgeResults.find(
			(j) => j.roundNumber === round.roundNumber && j.status === "done",
		);
		if (jr) {
			const stripped = stripInternalBlocks(jr.messageText);
			const displayText = stripped || jr.verdict?.reasoning || "";
			const judgeLines = displayText
				? [screenLine([{ text: displayText, style: {} }])]
				: [];
			chunks.push({
				type: "judge",
				roundNumber: round.roundNumber,
				status: "done",
				shouldContinue: jr.verdict?.shouldContinue,
				lines: judgeLines,
			});
		}
	}

	// 2. Active round
	const active = findActiveRound(state);
	if (active) {
		const leftBlocks = active.proposer
			? snapshotToBlocks(active.proposer, "proposer", state.proposer.agentType)
			: liveStateToBlocks(state.proposer);

		let rightBlocks: RenderBlock[];
		if (active.challenger) {
			rightBlocks = snapshotToBlocks(
				active.challenger,
				"challenger",
				state.challenger.agentType,
			);
		} else if (active.proposer) {
			rightBlocks = liveStateToBlocks(state.challenger);
		} else {
			rightBlocks = idleBlocks("challenger", state.challenger.agentType);
		}

		chunks.push({
			type: "round",
			roundNumber: active.roundNumber,
			maxRounds: state.metrics.maxRounds,
			active: true,
			collapsed: false,
			leftBlocks,
			rightBlocks,
			leftLines: [],
			rightLines: [],
			height: 0,
		});
	}

	// 3. Active judge (skip if already emitted as a completed judgeResult above)
	const alreadyEmittedJudgeRounds = new Set(
		state.judgeResults
			.filter((j) => j.status === "done")
			.map((j) => j.roundNumber),
	);
	if (
		state.judge.visible &&
		state.judge.judgeStatus !== "idle" &&
		!alreadyEmittedJudgeRounds.has(state.judge.roundNumber)
	) {
		const isDone = state.judge.judgeStatus === "done";
		const stripped = stripInternalBlocks(state.judge.judgeMessageText);
		const displayText =
			stripped || (isDone ? (state.judge.verdict?.reasoning ?? "") : "");

		let judgeLines: ReturnType<typeof screenLine>[];
		if (displayText) {
			judgeLines = [screenLine([{ text: displayText, style: {} }])];
		} else if (!isDone) {
			judgeLines = [
				screenLine([
					{ text: "Evaluating...", style: { color: "yellow", italic: true } },
				]),
			];
		} else {
			judgeLines = [];
		}
		chunks.push({
			type: "judge",
			roundNumber: state.judge.roundNumber,
			status: isDone ? "done" : "streaming",
			shouldContinue: state.judge.verdict?.shouldContinue,
			lines: judgeLines,
		});
	}

	// 4. Summary generating indicator
	if (state.summaryGenerating && !state.summary) {
		chunks.push({
			type: "summary",
			lines: [
				screenLine([
					{
						text: "Generating final summary and action plan...",
						style: { color: "yellow", italic: true },
					},
				]),
			],
		});
	}

	// 5. Final summary
	if (state.summary) {
		const summaryLines = [
			screenLine([
				{
					text: `Terminated: ${state.summary.terminationReason ?? "unknown"} (${state.summary.roundsCompleted} rounds)`,
					style: {},
				},
			]),
		];
		if (state.summary.recommendedAction) {
			summaryLines.push(
				screenLine([
					{
						text: `Decision: ${state.summary.recommendedAction}`,
						style: { bold: true },
					},
				]),
			);
		}
		if (state.summary.outputDir) {
			summaryLines.push(
				screenLine([
					{ text: "Action Plan: ", style: { bold: true } },
					{
						text: join(state.summary.outputDir, "action-plan.html"),
						style: { color: "blue" },
					},
				]),
			);
			summaryLines.push(
				screenLine([
					{ text: "Transcript:  ", style: { bold: true } },
					{
						text: join(state.summary.outputDir, "transcript.html"),
						style: { color: "blue" },
					},
				]),
			);
		}
		chunks.push({ type: "summary", lines: summaryLines });
	}

	return chunks;
}

/**
 * Populate leftLines/rightLines and height on RoundRenderChunks.
 * Called after rebuildChunks, before buildGlobalLineBuffer.
 */
export function populateChunkLines(
	chunks: ContentChunk[],
	panelWidth: number,
): void {
	for (const chunk of chunks) {
		if (
			chunk.type === "round" &&
			!chunk.collapsed &&
			chunk.leftBlocks &&
			chunk.rightBlocks
		) {
			chunk.leftLines = buildPanelLines(chunk.leftBlocks, panelWidth);
			chunk.rightLines = buildPanelLines(chunk.rightBlocks, panelWidth);
			chunk.height = Math.max(chunk.leftLines.length, chunk.rightLines.length);
		}
	}
}
