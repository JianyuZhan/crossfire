import { Box, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import {
	CommandInput,
	type ParsedCommand,
} from "./components/command-input.js";
import { CommandStatusLine } from "./components/command-status-line.js";
import { HeaderBar } from "./components/header-bar.js";
import { MetricsBar } from "./components/metrics-bar.js";
import { ScrollableContent } from "./components/scrollable-content.js";
import type { EventSource } from "./replay/event-source.js";
import type { TuiStore } from "./state/tui-store.js";
import type { RenderSnapshot, TuiState } from "./state/types.js";

interface AppProps {
	store: TuiStore;
	source: EventSource;
	onCommand?: (cmd: ParsedCommand) => void;
}

const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const HOME_SEQS = ["\x1b[H", "\x1b[1~"];
const END_SEQS = ["\x1b[F", "\x1b[4~"];

function computeFixedAreaHeight(_state: TuiState): number {
	// HeaderBar: border(2) + title(1) + topic(1) + agents(1) + round/phase(1) = 6
	// MetricsBar: 1, CommandStatusLine: 1, CommandInput: 1
	// Conservative upper bound = 9
	return 9;
}

export function App({
	store,
	source,
	onCommand,
}: AppProps): React.ReactElement {
	const [snapshot, setSnapshot] = useState<RenderSnapshot>(
		store.getRenderSnapshot(),
	);

	// Subscribe to store + start event source
	useEffect(() => {
		const unsub = store.subscribe(() => setSnapshot(store.getRenderSnapshot()));
		source.start();
		return () => {
			unsub();
			source.stop();
		};
	}, [store, source]);

	// Resize effect A: bind resize listener
	useEffect(() => {
		const stdout = process.stdout;
		const onResize = () => {
			store.setViewportDimensions(
				stdout.rows - computeFixedAreaHeight(store.getState()),
				stdout.columns,
			);
		};
		stdout.on("resize", onResize);
		onResize(); // initial measurement
		return () => {
			stdout.off("resize", onResize);
		};
	}, [store]);

	// Resize effect B: re-measure when fixed-area-affecting state changes
	useEffect(() => {
		const stdout = process.stdout;
		store.setViewportDimensions(
			stdout.rows - computeFixedAreaHeight(store.getState()),
			stdout.columns,
		);
	}, [store, snapshot.state.command.mode, snapshot.state.judge.visible]);

	// Scroll key handling
	const pageSize = Math.max(1, snapshot.viewport.viewportHeight - 2);
	useInput((input, key) => {
		// Don't process scroll keys when command input is focused
		if (key.upArrow) store.scroll(-1);
		else if (key.downArrow) store.scroll(1);
		else if (input === PAGE_UP) store.scroll(-pageSize);
		else if (input === PAGE_DOWN) store.scroll(pageSize);
		else if (HOME_SEQS.includes(input)) store.scrollToTop();
		else if (END_SEQS.includes(input)) store.scrollToBottom();
		// Ctrl+U / Ctrl+D as fallback for PgUp/PgDn
		else if (input === "u" && key.ctrl) store.scroll(-pageSize);
		else if (input === "d" && key.ctrl) store.scroll(pageSize);
	});

	const handleCommand = (cmd: ParsedCommand): void => {
		if (cmd.type === "expand") {
			store.setRoundCollapsed(cmd.roundNumber, false);
			return;
		}
		if (cmd.type === "collapse") {
			store.setRoundCollapsed(cmd.roundNumber, true);
			return;
		}
		if (cmd.type === "top") {
			store.scrollToTop();
			return;
		}
		if (cmd.type === "bottom") {
			store.scrollToBottom();
			return;
		}
		if (cmd.type === "jump") {
			if (cmd.target === "round" && typeof cmd.value === "number") {
				store.jumpToRound(cmd.value);
				return;
			}
		}
		onCommand?.(cmd);
	};

	const { state, viewport, visibleLines } = snapshot;

	const proposerInfo = state.proposer.agentType
		? { agentType: state.proposer.agentType, model: state.proposer.model }
		: undefined;
	const challengerInfo = state.challenger.agentType
		? { agentType: state.challenger.agentType, model: state.challenger.model }
		: undefined;

	return (
		<Box flexDirection="column" height="100%">
			<HeaderBar
				debateId={state.metrics.debateId}
				topic={state.debateState.config.topic}
				currentRound={state.metrics.currentRound}
				maxRounds={state.metrics.maxRounds}
				phase={state.debateState.phase}
				mode={state.command.mode}
				proposerInfo={proposerInfo}
				challengerInfo={challengerInfo}
			/>
			<ScrollableContent lines={visibleLines} viewport={viewport} />
			<MetricsBar state={state.metrics} viewport={viewport} />
			<CommandStatusLine state={state.command} />
			<CommandInput state={state.command} onCommand={handleCommand} />
		</Box>
	);
}
