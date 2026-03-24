import { Box, Text } from "ink";
import type React from "react";
import type { CommandState } from "../state/types.js";

interface CommandStatusLineProps {
	state: CommandState;
}

export function CommandStatusLine({
	state,
}: CommandStatusLineProps): React.ReactElement | null {
	// Hide in normal mode with nothing special to show
	if (
		state.mode === "normal" &&
		state.pendingApprovals.length === 0 &&
		state.replaySpeed === undefined &&
		!state.replayPaused
	) {
		return null;
	}

	return (
		<Box paddingX={1}>
			<Text dimColor>
				{state.mode === "approval" && "APPROVAL MODE"}
				{state.mode === "replay" && "REPLAY MODE"}
				{state.pendingApprovals.length > 0 &&
					` | PENDING: ${state.pendingApprovals.map((a) => `"${a.title}"`).join(", ")} [/approve or /deny]`}
				{state.replaySpeed !== undefined && ` | Speed: ${state.replaySpeed}x`}
				{state.replayPaused && " | PAUSED"}
			</Text>
		</Box>
	);
}
