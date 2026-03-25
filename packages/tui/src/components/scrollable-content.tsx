import { Box, Text } from "ink";
import type React from "react";
import type { ScreenLine, ViewportState } from "../state/types.js";

interface ScrollableContentProps {
	lines: ScreenLine[];
	viewport: ViewportState;
}

export function ScrollableContent({
	lines,
	viewport,
}: ScrollableContentProps): React.ReactElement {
	return (
		<Box flexDirection="column" height={viewport.viewportHeight}>
			{lines.map((line, i) => (
				<Text key={i} wrap="truncate">
					{line.segments.map((seg, j) => (
						<Text
							key={`${i}-${j}`}
							bold={seg.style.bold}
							dimColor={seg.style.dim}
							color={seg.style.color}
							italic={seg.style.italic}
						>
							{seg.text}
						</Text>
					))}
				</Text>
			))}
		</Box>
	);
}
