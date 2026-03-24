import { Box } from "ink";
import type React from "react";

interface SplitPanelProps {
	children: [React.ReactNode, React.ReactNode];
}

export function SplitPanel({ children }: SplitPanelProps): React.ReactElement {
	return (
		<Box flexDirection="row" flexGrow={1}>
			<Box
				flexGrow={1}
				flexBasis="50%"
				flexDirection="column"
				borderStyle="single"
				marginRight={1}
			>
				{children[0]}
			</Box>
			<Box
				flexGrow={1}
				flexBasis="50%"
				flexDirection="column"
				borderStyle="single"
			>
				{children[1]}
			</Box>
		</Box>
	);
}
