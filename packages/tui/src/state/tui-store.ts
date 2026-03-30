import type { ApprovalOption } from "@crossfire/adapter-core";
import {
	type AnyEvent,
	type DebateState,
	projectState,
} from "@crossfire/orchestrator-core";
import { populateChunkLines, rebuildChunks } from "../render/chunk-builder.js";
import { buildGlobalLineBuffer } from "../render/line-buffer.js";
import { stripInternalToolBlocks } from "./strip-internal.js";
import type {
	AgentTurnSnapshot,
	AgentUsage,
	CommandState,
	ContentChunk,
	JudgeRoundResult,
	JudgeStripState,
	LiveAgentPanelState,
	MetricsState,
	RenderSnapshot,
	ScreenLine,
	TuiRound,
	TuiState,
	ViewportState,
} from "./types.js";

const MAX_THINKING_BYTES = 4096;

/** Internal meta-tool names that should not appear in the TUI */
const INTERNAL_TOOLS = new Set(["debate_meta", "judge_verdict"]);

function defaultAgentPanel(
	role: "proposer" | "challenger",
): LiveAgentPanelState {
	return {
		role,
		status: "idle",
		thinkingText: "",
		thinkingType: undefined,
		currentMessageText: "",
		tools: [],
		subagents: [],
		warnings: [],
	};
}

function defaultJudge(): JudgeStripState {
	return {
		visible: false,
		roundNumber: 0,
		judgeStatus: "idle",
		judgeMessageText: "",
	};
}

function defaultUsage(): AgentUsage {
	return { tokens: 0, costUsd: 0 };
}

function defaultMetrics(): MetricsState {
	return {
		currentRound: 0,
		maxRounds: 0,
		convergencePercent: 0,
		stanceDelta: 1.0,
		mutualConcessions: 0,
		bothWantToConclude: false,
		totalTokens: 0,
		proposerUsage: defaultUsage(),
		challengerUsage: defaultUsage(),
	};
}

function defaultCommand(): CommandState {
	return { mode: "normal", pendingApprovals: [] };
}

function truncateSummary(text: string, max = 160): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= max) return compact;
	return `${compact.slice(0, max - 1)}…`;
}

function summarizeValue(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return truncateSummary(value);
	try {
		return truncateSummary(JSON.stringify(value));
	} catch {
		return undefined;
	}
}

function summarizeApprovalDetail(event: {
	approvalType: string;
	title: string;
	payload?: unknown;
}): string | undefined {
	const payload =
		event.payload && typeof event.payload === "object"
			? (event.payload as Record<string, unknown>)
			: undefined;
	if (!payload) return undefined;

	switch (event.approvalType) {
		case "tool": {
			const toolName = payload.tool_name ?? payload.name;
			const toolInput =
				payload.tool_input ?? payload.input ?? payload.updatedInput;
			if (typeof toolName === "string") {
				const inputSummary = summarizeValue(toolInput);
				return inputSummary
					? `Tool: ${toolName} ${inputSummary}`
					: `Tool: ${toolName}`;
			}
			break;
		}
		case "command":
			if (typeof payload.command === "string") {
				return `Command: ${truncateSummary(payload.command)}`;
			}
			break;
		case "file-change":
			if (typeof payload.path === "string") {
				return `File change: ${truncateSummary(payload.path)}`;
			}
			break;
		case "user-input":
			if (typeof payload.prompt === "string") {
				return `Prompt: ${truncateSummary(payload.prompt)}`;
			}
			break;
	}

	return summarizeValue(payload) ?? truncateSummary(event.title);
}

const DEFAULT_CONFIG = {
	topic: "",
	maxRounds: 10,
	judgeEveryNRounds: 0,
	convergenceThreshold: 0.3,
};

const DEFAULT_DEBATE_STATE: DebateState = {
	config: DEFAULT_CONFIG,
	phase: "idle",
	paused: false,
	currentRound: 0,
	turns: [],
	convergence: {
		converged: false,
		stanceDelta: 1.0,
		mutualConcessions: 0,
		bothWantToConclude: false,
	},
};

function captureSnapshot(panel: LiveAgentPanelState): AgentTurnSnapshot {
	return {
		messageText: stripInternalToolBlocks(panel.currentMessageText),
		thinkingText: panel.thinkingText || undefined,
		thinkingType: panel.thinkingType,
		latestPlan: panel.latestPlan?.map((step) => ({ ...step })),
		subagents: panel.subagents?.map((subagent) => ({ ...subagent })),
		tools: panel.tools.map((t) => ({ ...t, expanded: false })),
		turnDurationMs: panel.turnDurationMs,
		turnStatus: panel.turnStatus,
		warnings: [...panel.warnings],
		error: panel.error,
	};
}

export class TuiStore {
	private state: TuiState;
	private readonly listeners: Set<() => void> = new Set();
	private readonly allEvents: AnyEvent[] = [];
	private activeSpeaker: "proposer" | "challenger" | undefined;
	private activeJudgeTurnId: string | undefined;
	/** Cumulative token tracking for Codex adapters (keyed by role) */
	private cumulativeTokens = new Map<
		string,
		{ input: number; output: number }
	>();
	private viewport: ViewportState = {
		scrollOffset: 0,
		autoFollow: true,
		viewportHeight: 24,
		contentWidth: 80,
		contentHeight: 0,
	};
	private globalLines: ScreenLine[] = [];
	private chunks: ContentChunk[] = [];
	private dirty = false;
	private pendingFlush: ReturnType<typeof setTimeout> | null = null;
	private readonly flushIntervalMs = 16;
	private static readonly NEAR_BOTTOM_THRESHOLD = 2;

	// Only re-project full state on structural events (not high-frequency deltas)
	private static readonly STRUCTURAL_KINDS = new Set([
		"debate.started",
		"debate.paused",
		"debate.unpaused",
		"debate.extended",
		"round.started",
		"round.completed",
		"judge.started",
		"judge.completed",
		"debate.completed",
		"synthesis.started",
		"synthesis.completed",
		"message.final",
		"tool.call",
		"turn.completed",
	]);

	constructor() {
		this.state = {
			proposer: defaultAgentPanel("proposer"),
			challenger: defaultAgentPanel("challenger"),
			rounds: [],
			judgeResults: [],
			judge: defaultJudge(),
			metrics: defaultMetrics(),
			command: defaultCommand(),
			debateState: DEFAULT_DEBATE_STATE,
		};
	}

	handleEvent(event: AnyEvent): void {
		this.allEvents.push(event);
		this.applyEvent(event);

		if (TuiStore.STRUCTURAL_KINDS.has(event.kind)) {
			this.state.debateState = projectState(this.allEvents);
		}

		const ds = this.state.debateState;
		this.state.metrics.currentRound = ds.currentRound;
		this.state.metrics.stanceDelta = ds.convergence.stanceDelta;
		this.state.metrics.mutualConcessions = ds.convergence.mutualConcessions;
		this.state.metrics.bothWantToConclude = ds.convergence.bothWantToConclude;
		// Composite convergence: 50% stance, 30% concessions, 20% conclude
		const stanceScore = Math.max(0, 1 - ds.convergence.stanceDelta);
		const concessionScore = Math.min(ds.convergence.mutualConcessions / 5, 1.0);
		const concludeScore = ds.convergence.bothWantToConclude ? 1.0 : 0.0;
		this.state.metrics.convergencePercent = Math.round(
			Math.min(
				(stanceScore * 0.5 + concessionScore * 0.3 + concludeScore * 0.2) * 100,
				100,
			),
		);

		this.dirty = true;
		this.scheduleFlush();
	}

	getState(): Readonly<TuiState> {
		return this.state;
	}

	setRoundCollapsed(roundNumber: number, collapsed: boolean): void {
		const round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
		if (round?.proposer && round.challenger) {
			round.userCollapsed = collapsed;
			this.forceFlush();
		}
	}

	toggleRoundCollapse(roundNumber: number): void {
		const round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
		if (round?.proposer && round.challenger) {
			round.userCollapsed = !round.userCollapsed;
			this.forceFlush();
		}
	}

	subscribe(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	getViewport(): Readonly<ViewportState> {
		return this.viewport;
	}

	scroll(delta: number): void {
		const contentHeight = this.globalLines.length;
		const maxOffset = Math.max(0, contentHeight - this.viewport.viewportHeight);
		if (delta < 0) {
			this.viewport.scrollOffset = Math.min(
				maxOffset,
				this.viewport.scrollOffset - delta,
			);
			this.viewport.autoFollow = false;
		} else {
			this.viewport.scrollOffset = Math.max(
				0,
				this.viewport.scrollOffset - delta,
			);
			if (this.viewport.scrollOffset <= TuiStore.NEAR_BOTTOM_THRESHOLD) {
				this.viewport.scrollOffset = 0;
				this.viewport.autoFollow = true;
			}
		}
		for (const cb of this.listeners) cb();
	}

	scrollToTop(): void {
		const maxOffset = Math.max(
			0,
			this.globalLines.length - this.viewport.viewportHeight,
		);
		this.viewport.scrollOffset = maxOffset;
		this.viewport.autoFollow = false;
		for (const cb of this.listeners) cb();
	}

	scrollToBottom(): void {
		this.viewport.scrollOffset = 0;
		this.viewport.autoFollow = true;
		this.forceFlush();
	}

	jumpToRound(roundNumber: number): void {
		const round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
		if (round) round.userCollapsed = false;
		this.flush();
		const chunk = this.chunks.find(
			(c) => c.type === "round" && c.roundNumber === roundNumber,
		);
		if (chunk?.layoutMeta) {
			const targetLine = chunk.layoutMeta.startLine;
			const contentHeight = this.globalLines.length;
			this.viewport.scrollOffset = Math.max(
				0,
				contentHeight - targetLine - this.viewport.viewportHeight,
			);
			this.viewport.autoFollow = false;
		}
		for (const cb of this.listeners) cb();
	}

	setViewportDimensions(height: number, width: number): void {
		this.viewport.viewportHeight = Math.max(1, height);
		this.viewport.contentWidth = Math.max(20, width);
		const maxOffset = Math.max(
			0,
			this.globalLines.length - this.viewport.viewportHeight,
		);
		this.viewport.scrollOffset = Math.min(
			this.viewport.scrollOffset,
			maxOffset,
		);
		this.dirty = true;
		this.scheduleFlush();
	}

	getVisibleLines(): ScreenLine[] {
		const total = this.globalLines.length;
		const vh = this.viewport.viewportHeight;
		const offset = this.viewport.scrollOffset;
		const end = total - offset;
		const start = Math.max(0, end - vh);
		return this.globalLines.slice(start, end);
	}

	getRenderSnapshot(): RenderSnapshot {
		return {
			state: this.state,
			viewport: { ...this.viewport },
			visibleLines: this.getVisibleLines(),
		};
	}

	forceFlush(): void {
		this.flush();
		for (const cb of this.listeners) cb();
	}

	dispose(): void {
		if (this.pendingFlush) {
			clearTimeout(this.pendingFlush);
			this.pendingFlush = null;
		}
	}

	private scheduleFlush(): void {
		if (this.pendingFlush !== null) return;
		this.pendingFlush = setTimeout(() => {
			this.pendingFlush = null;
			if (this.dirty) {
				this.flush();
				for (const cb of this.listeners) cb();
			}
		}, this.flushIntervalMs);
	}

	private flush(): void {
		if (this.viewport.contentWidth <= 0 || this.viewport.viewportHeight <= 0) {
			// Don't clear dirty — retry on next valid flush after resize
			return;
		}
		this.dirty = false;

		// When user is manually scrolled (autoFollow off), preserve absolute
		// position in the content so the view doesn't drift as new lines arrive.
		const prevTotal = this.globalLines.length;
		const wasFollowing = this.viewport.autoFollow;
		const absoluteTop = wasFollowing
			? undefined
			: Math.max(
					0,
					prevTotal - this.viewport.scrollOffset - this.viewport.viewportHeight,
				);

		const panelWidth = Math.floor((this.viewport.contentWidth - 3) / 2);
		this.chunks = rebuildChunks(this.state);
		populateChunkLines(this.chunks, panelWidth);
		this.globalLines = buildGlobalLineBuffer(
			this.chunks,
			this.viewport.contentWidth,
		);
		this.viewport.contentHeight = this.globalLines.length;

		// Assign layoutMeta FIRST (needed for autoFollow target calculation)
		let lineIdx = 0;
		for (let ci = 0; ci < this.chunks.length; ci++) {
			if (ci > 0) lineIdx++; // separator between chunks
			const chunk = this.chunks[ci];
			const startLine = lineIdx;
			if (chunk.type === "round") {
				if (chunk.collapsed) {
					// header(1) + P(1) + C(1) + optional judge(1)
					const hasJudge =
						chunk.collapsedSummary &&
						typeof chunk.collapsedSummary === "object" &&
						chunk.collapsedSummary.judgeLine;
					lineIdx += 3 + (hasJudge ? 1 : 0);
				} else {
					// top-border(1) + content(height) + bottom-border(1)
					let roundLines = 2 + chunk.height;
					// Embedded judge section lines
					if (chunk.judgeResult && chunk.judgeResult.status === "done") {
						const textLen = (chunk.judgeResult.messageText ?? "").length;
						const judgeTextLines = Math.max(
							1,
							Math.ceil(textLen / Math.max(1, this.viewport.contentWidth - 4)),
						);
						roundLines +=
							1 + judgeTextLines + (chunk.judgeResult.verdict ? 1 : 0);
					}
					lineIdx += roundLines;
				}
			} else {
				lineIdx += 1 + (chunk.lines?.length ?? 0);
			}
			chunk.layoutMeta = { startLine, endLine: lineIdx - 1 };
		}

		if (this.viewport.autoFollow) {
			this.scrollToActiveContent();
		} else if (absoluteTop !== undefined) {
			// Restore absolute position: convert absolute top-line back to offset-from-bottom
			this.viewport.scrollOffset = Math.max(
				0,
				this.globalLines.length - absoluteTop - this.viewport.viewportHeight,
			);
		}
		const maxOffset = Math.max(
			0,
			this.globalLines.length - this.viewport.viewportHeight,
		);
		this.viewport.scrollOffset = Math.min(
			this.viewport.scrollOffset,
			maxOffset,
		);
	}

	/**
	 * In auto-follow mode, scroll so the active speaker's latest line
	 * is visible at the bottom of the viewport.
	 *
	 * In a side-by-side round, the active speaker's content may be in the
	 * shorter panel (e.g. challenger just started while proposer has 20 lines).
	 * Scrolling to the absolute bottom would show proposer's end + empty space,
	 * missing the challenger's output entirely.
	 */
	private scrollToActiveContent(): void {
		// Find the active (non-collapsed) round chunk
		const activeChunk = this.chunks.find(
			(c) => c.type === "round" && !c.collapsed && c.active,
		);

		if (activeChunk && activeChunk.type === "round" && activeChunk.layoutMeta) {
			const activeLines =
				this.activeSpeaker === "challenger"
					? activeChunk.rightLines
					: activeChunk.leftLines;
			const startLine = activeChunk.layoutMeta.startLine;
			// Active content ends at: roundStart + 1 (top border) + activeLines.length
			const activeContentEnd = startLine + 1 + Math.max(1, activeLines.length);
			const total = this.globalLines.length;
			const vh = this.viewport.viewportHeight;

			// headerAtTop: round header pinned to viewport top — best for short content
			const headerAtTop = Math.max(0, total - startLine - vh);
			// contentAtBottom: active speaker's latest line at viewport bottom — best for long content
			const contentAtBottom = Math.max(0, total - activeContentEnd);

			// When active content < viewport, headerAtTop is smaller (round visible from top).
			// When active content > viewport, contentAtBottom is smaller (follow latest line).
			this.viewport.scrollOffset = Math.min(headerAtTop, contentAtBottom);
		} else {
			// No active round (judge, summary, between rounds) → bottom
			this.viewport.scrollOffset = 0;
		}
	}

	/**
	 * Compute token deltas from a usage event.
	 * Codex reports cumulative totals; this method converts them to per-event deltas.
	 */
	private computeTokenDeltas(e: {
		inputTokens: number;
		outputTokens: number;
		semantics?: string;
	}): { inputDelta: number; outputDelta: number } {
		if (e.semantics !== "cumulative_thread_total" || !this.activeSpeaker) {
			return { inputDelta: e.inputTokens, outputDelta: e.outputTokens };
		}

		const usage =
			this.activeSpeaker === "proposer"
				? this.state.metrics.proposerUsage
				: this.state.metrics.challengerUsage;
		const prev = this.cumulativeTokens.get(this.activeSpeaker);

		let inputDelta: number;
		let outputDelta: number;

		if (prev) {
			inputDelta = e.inputTokens - prev.input;
			outputDelta = e.outputTokens - prev.output;
			usage.lastDeltaInput = inputDelta;
			usage.previousCumulativeInput = prev.input;
		} else {
			inputDelta = e.inputTokens;
			outputDelta = e.outputTokens;
			usage.lastDeltaInput = e.inputTokens;
		}

		this.cumulativeTokens.set(this.activeSpeaker, {
			input: e.inputTokens,
			output: e.outputTokens,
		});

		return { inputDelta, outputDelta };
	}

	private panel(): LiveAgentPanelState | undefined {
		if (!this.activeSpeaker) return undefined;
		return this.state[this.activeSpeaker];
	}

	private activeJudgeResult(): JudgeRoundResult | undefined {
		// Find the last "evaluating" entry in judgeResults
		for (let i = this.state.judgeResults.length - 1; i >= 0; i--) {
			if (this.state.judgeResults[i].status === "evaluating") {
				return this.state.judgeResults[i];
			}
		}
		return undefined;
	}

	private getOrCreateRound(roundNumber: number): TuiRound {
		let round = this.state.rounds.find((r) => r.roundNumber === roundNumber);
		if (!round) {
			round = { roundNumber };
			this.state.rounds.push(round);
		}
		return round;
	}

	private applyEvent(event: AnyEvent): void {
		switch (event.kind) {
			case "debate.started": {
				const e = event as {
					config: typeof DEFAULT_CONFIG;
					roles?: {
						proposer?: { agentType: string; model?: string };
						challenger?: { agentType: string; model?: string };
					};
				};
				this.state.metrics.maxRounds = e.config.maxRounds;
				this.state.command.livePaused = false;
				if ((event as { debateId?: string }).debateId) {
					this.state.metrics.debateId = (
						event as { debateId: string }
					).debateId;
				}
				if (e.roles?.proposer) {
					this.state.proposer.agentType = e.roles.proposer.agentType;
					this.state.proposer.model = e.roles.proposer.model;
				}
				if (e.roles?.challenger) {
					this.state.challenger.agentType = e.roles.challenger.agentType;
					this.state.challenger.model = e.roles.challenger.model;
				}
				break;
			}
			case "session.started": {
				// SDK reports the real model ID — backfill if not set from debate.started
				const p = this.panel();
				if (p && !p.model) {
					const e = event as { model?: string };
					if (e.model) p.model = e.model;
				}
				break;
			}
			case "round.started": {
				const e = event as {
					roundNumber: number;
					speaker: "proposer" | "challenger";
				};
				this.activeSpeaker = e.speaker;
				const p = this.state[e.speaker];
				p.thinkingText = "";
				p.thinkingType = undefined;
				p.currentMessageText = "";
				p.tools = [];
				p.latestPlan = undefined;
				p.subagents = [];
				p.warnings = [];
				p.error = undefined;
				p.status = "thinking";
				p.turnDurationMs = undefined;
				p.turnStatus = undefined;
				// Clear completed judge panel when new round begins
				if (this.state.judge.visible) {
					this.state.judge.visible = false;
					this.state.judge.judgeStatus = "idle";
				}
				// Auto-collapse previous completed rounds when a new round's proposer starts
				if (e.speaker === "proposer") {
					for (const r of this.state.rounds) {
						if (r.proposer && r.challenger) r.collapsed = true;
					}
				}
				// Ensure round entry exists
				this.getOrCreateRound(e.roundNumber);
				break;
			}
			case "round.completed": {
				const e = event as {
					roundNumber: number;
					speaker: "proposer" | "challenger";
				};
				// Snapshot completed turn into the round
				const round = this.getOrCreateRound(e.roundNumber);
				round[e.speaker] = captureSnapshot(this.state[e.speaker]);
				this.activeSpeaker = undefined;
				break;
			}
			case "thinking.delta": {
				const p = this.panel();
				if (!p) break;
				const e = event as {
					text: string;
					thinkingType?: "raw-thinking" | "reasoning-summary";
				};
				if (p.status === "idle") {
					p.thinkingText = "";
					p.thinkingType = undefined;
					p.currentMessageText = "";
				}
				p.status = "thinking";
				p.thinkingText += e.text;
				p.thinkingType = e.thinkingType ?? p.thinkingType;
				if (p.thinkingText.length > MAX_THINKING_BYTES) {
					p.thinkingText = p.thinkingText.slice(-MAX_THINKING_BYTES);
				}
				break;
			}
			case "message.delta": {
				const p = this.panel();
				if (p) {
					if (p.status === "idle") {
						p.thinkingText = "";
						p.thinkingType = undefined;
						p.currentMessageText = "";
					}
					p.status = "speaking";
					p.currentMessageText += (event as { text: string }).text;
				} else if (this.state.judge.judgeStatus === "evaluating") {
					// Route judge message to judge panel, strip internal tool blocks during streaming
					const rawJudge =
						this.state.judge.judgeMessageText +
						(event as { text: string }).text;
					this.state.judge.judgeMessageText = rawJudge;
					const stripped = stripInternalToolBlocks(rawJudge);
					// Also update the active judgeResults entry (always stripped for display)
					const jr = this.activeJudgeResult();
					if (jr) jr.messageText = stripped;
				}
				break;
			}
			case "message.final": {
				const p = this.panel();
				if (p) {
					p.currentMessageText = stripInternalToolBlocks(
						(event as { text: string }).text,
					);
					p.status = "done";
				} else if (this.state.judge.judgeStatus === "evaluating") {
					// Route judge final message to judge panel
					this.state.judge.judgeMessageText = stripInternalToolBlocks(
						(event as { text: string }).text,
					);
					const jr = this.activeJudgeResult();
					if (jr) jr.messageText = this.state.judge.judgeMessageText;
				}
				break;
			}
			case "tool.call": {
				const p = this.panel();
				if (!p) break;
				const e = event as {
					toolUseId: string;
					toolName: string;
					input: unknown;
				};
				if (INTERNAL_TOOLS.has(e.toolName)) break;
				if (p.status === "idle") {
					p.thinkingText = "";
					p.thinkingType = undefined;
					p.currentMessageText = "";
				}
				p.status = "tool";
				p.tools.push({
					toolUseId: e.toolUseId,
					toolName: e.toolName,
					inputSummary: JSON.stringify(e.input).slice(0, 100),
					status: "running",
					expanded: true,
				});
				break;
			}
			case "tool.progress": {
				const p = this.panel();
				if (!p) break;
				const e = event as { toolUseId: string; elapsedMs?: number };
				const tool = p.tools.find((t) => t.toolUseId === e.toolUseId);
				if (tool && e.elapsedMs !== undefined) tool.elapsedMs = e.elapsedMs;
				break;
			}
			case "tool.result": {
				const p = this.panel();
				if (!p) break;
				const e = event as {
					toolUseId: string;
					toolName: string;
					success: boolean;
				};
				const tool = p.tools.find((t) => t.toolUseId === e.toolUseId);
				if (tool) {
					tool.status = e.success ? "done" : "error";
					tool.resultSummary = e.success ? "success" : "error";
				}
				break;
			}
			case "turn.completed": {
				const p = this.panel();
				if (!p) break;
				const e = event as {
					status: "completed" | "interrupted" | "failed" | "timeout";
					durationMs: number;
				};
				p.status = "done";
				p.turnDurationMs = e.durationMs;
				p.turnStatus = e.status;
				for (const tool of p.tools) tool.expanded = false;
				break;
			}
			case "approval.request": {
				const e = event as {
					requestId: string;
					adapterId: string;
					adapterSessionId: string;
					approvalType: string;
					title: string;
					payload?: unknown;
					suggestion?: "allow" | "deny";
					options?: ApprovalOption[];
				};
				this.state.command.pendingApprovals.push({
					requestId: e.requestId,
					adapterId: e.adapterId,
					adapterSessionId: e.adapterSessionId,
					approvalType: e.approvalType,
					title: e.title,
					detail: summarizeApprovalDetail(e),
					suggestion: e.suggestion,
					options: e.options,
				});
				this.state.command.mode = "approval";
				break;
			}
			case "approval.resolved": {
				const e = event as { requestId: string };
				this.state.command.pendingApprovals =
					this.state.command.pendingApprovals.filter(
						(a) => a.requestId !== e.requestId,
					);
				if (this.state.command.pendingApprovals.length === 0)
					this.state.command.mode = "normal";
				break;
			}
			case "debate.paused": {
				this.state.command.livePaused = true;
				break;
			}
			case "debate.unpaused":
			case "debate.resumed": {
				this.state.command.livePaused = false;
				break;
			}
			case "debate.extended": {
				this.state.metrics.maxRounds = (
					event as { newMaxRounds: number }
				).newMaxRounds;
				break;
			}
			case "usage.updated": {
				const e = event as {
					inputTokens: number;
					outputTokens: number;
					totalCostUsd?: number;
					semantics?: string;
					cacheReadTokens?: number;
					localMetrics?: { totalChars: number; totalUtf8Bytes: number };
				};

				const { inputDelta, outputDelta } = this.computeTokenDeltas(e);

				const tokens = inputDelta + outputDelta;
				const cost = e.totalCostUsd ?? 0;
				this.state.metrics.totalTokens += tokens;
				if (e.totalCostUsd !== undefined) {
					this.state.metrics.totalCostUsd =
						(this.state.metrics.totalCostUsd ?? 0) + e.totalCostUsd;
				}

				if (this.activeSpeaker) {
					const usage =
						this.activeSpeaker === "proposer"
							? this.state.metrics.proposerUsage
							: this.state.metrics.challengerUsage;
					usage.tokens += tokens;
					usage.costUsd += cost;

					if (e.localMetrics) {
						usage.localTotalChars =
							(usage.localTotalChars ?? 0) + e.localMetrics.totalChars;
						usage.localTotalUtf8Bytes =
							(usage.localTotalUtf8Bytes ?? 0) + e.localMetrics.totalUtf8Bytes;
					}

					if (
						e.semantics === "session_delta_or_cached" &&
						e.cacheReadTokens !== undefined
					) {
						usage.cacheReadTokens =
							(usage.cacheReadTokens ?? 0) + e.cacheReadTokens;
						usage.observedInputPlusCacheRead =
							e.inputTokens + e.cacheReadTokens;
					}
				}
				break;
			}
			case "run.error": {
				const p = this.panel();
				if (!p) break;
				p.error = (event as { message: string }).message;
				p.status = "error";
				break;
			}
			case "run.warning": {
				const p = this.panel();
				if (!p) break;
				p.warnings.push((event as { message: string }).message);
				break;
			}
			case "judge.started": {
				const e = event as { roundNumber: number };
				this.state.judge.visible = true;
				this.state.judge.judgeStatus = "evaluating";
				this.state.judge.roundNumber = e.roundNumber;
				this.state.judge.judgeMessageText = "";
				this.state.judge.verdict = undefined;
				// Also track in judgeResults
				this.state.judgeResults.push({
					roundNumber: e.roundNumber,
					status: "evaluating",
					messageText: "",
				});
				break;
			}
			case "judge.completed": {
				const e = event as {
					roundNumber: number;
					verdict: TuiState["judge"]["verdict"];
				};
				// Stay visible as "done" until next round.started clears it
				this.state.judge.judgeStatus = "done";
				this.state.judge.visible = true;
				this.state.judge.verdict = e.verdict;
				if (e.verdict)
					this.state.metrics.judgeVerdict = {
						shouldContinue: e.verdict.shouldContinue,
						leading: e.verdict.leading,
					};
				// Update the last evaluating judgeResult (handles multiple judges per round)
				const jr = this.activeJudgeResult();
				if (jr) {
					jr.status = "done";
					jr.verdict = e.verdict;
				}
				break;
			}
			case "plan.updated": {
				const p = this.panel();
				if (!p) break;
				const e = event as {
					steps: Array<{
						description: string;
						status: "pending" | "in_progress" | "completed" | "failed";
					}>;
				};
				if (e.steps) {
					p.latestPlan = e.steps.map((step, idx) => ({
						id: `step-${idx}`,
						title: step.description,
						status: step.status,
					}));
				}
				break;
			}
			case "subagent.started": {
				const p = this.panel();
				if (!p) break;
				const e = event as { subagentId: string; description?: string };
				if (!p.subagents) p.subagents = [];
				const existing = p.subagents.find(
					(subagent) => subagent.subagentId === e.subagentId,
				);
				if (existing) {
					existing.description = e.description ?? existing.description;
					existing.status = "running";
				} else {
					p.subagents.push({
						subagentId: e.subagentId,
						description: e.description,
						status: "running",
					});
				}
				break;
			}
			case "subagent.completed": {
				const p = this.panel();
				if (!p?.subagents) break;
				const e = event as { subagentId: string };
				const existing = p.subagents.find(
					(subagent) => subagent.subagentId === e.subagentId,
				);
				if (existing) {
					existing.status = "completed";
				} else {
					p.subagents.push({
						subagentId: e.subagentId,
						status: "completed",
					});
				}
				break;
			}
			case "synthesis.started": {
				this.state.summaryGenerating = true;
				break;
			}
			case "synthesis.completed": {
				// summaryGenerating cleared by debate.completed handler
				break;
			}
			case "debate.completed": {
				// Keep judge panel visible on debate end (user wants to read it)
				this.state.command.livePaused = false;
				this.state.summaryGenerating = false;
				const e = event as {
					summary?: Record<string, unknown>;
					outputDir?: string;
				};
				if (e.summary) {
					this.state.summary = {
						terminationReason: String(e.summary.terminationReason ?? "unknown"),
						roundsCompleted: Number(e.summary.roundsCompleted ?? 0),
						leading: String(e.summary.leading ?? "unknown"),
						judgeScore: e.summary.judgeScore as {
							proposer: number;
							challenger: number;
						} | null,
						recommendedAction: e.summary.recommendedAction
							? String(e.summary.recommendedAction)
							: null,
						consensus: Array.isArray(e.summary.consensus)
							? (e.summary.consensus as string[])
							: [],
						unresolved: Array.isArray(e.summary.unresolved)
							? (e.summary.unresolved as string[])
							: [],
						totalTurns: Number(e.summary.totalTurns ?? 0),
						outputDir: e.outputDir ? String(e.outputDir) : undefined,
					};
				}
				break;
			}
			default:
				break;
		}
	}
}
