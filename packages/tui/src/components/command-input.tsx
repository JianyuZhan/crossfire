import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { CommandState } from "../state/types.js";

export type ParsedCommand =
	| { type: "stop" }
	| { type: "pause" }
	| { type: "resume" }
	| {
			type: "inject";
			target: "proposer" | "challenger" | "both";
			text: string;
			priority: "normal" | "high";
	  }
	| { type: "inject-judge"; text: string }
	| { type: "extend"; rounds: number }
	| { type: "approve"; requestId?: string }
	| { type: "deny"; requestId?: string }
	| { type: "speed"; multiplier: number }
	| { type: "jump"; target: "round" | "turn"; value: number | string }
	| { type: "expand"; roundNumber: number }
	| { type: "collapse"; roundNumber: number }
	| { type: "top" }
	| { type: "bottom" }
	| { type: "unknown"; raw: string };

export function parseCommand(input: string, mode: string): ParsedCommand {
	const parts = input.trim().split(/\s+/);
	const cmd = parts[0];
	switch (cmd) {
		case "/stop":
			return { type: "stop" };
		case "/pause":
			return { type: "pause" };
		case "/resume":
			return { type: "resume" };
		case "/inject": {
			const target = parts[1];
			if (target === "judge") {
				return { type: "inject-judge", text: parts.slice(2).join(" ") };
			}
			if (target !== "proposer" && target !== "challenger" && target !== "both")
				return { type: "unknown", raw: input };
			return {
				type: "inject",
				target,
				text: parts.slice(2).join(" "),
				priority: "normal",
			};
		}
		case "/inject!": {
			const target = parts[1] as "proposer" | "challenger" | "both";
			if (target !== "proposer" && target !== "challenger" && target !== "both")
				return { type: "unknown", raw: input };
			return {
				type: "inject",
				target,
				text: parts.slice(2).join(" "),
				priority: "high",
			};
		}
		case "/extend": {
			const n = Number.parseInt(parts[1], 10);
			if (Number.isNaN(n)) return { type: "unknown", raw: input };
			return { type: "extend", rounds: n };
		}
		case "/approve":
			return { type: "approve", requestId: parts[1] };
		case "/deny":
			return { type: "deny", requestId: parts[1] };
		case "/speed": {
			const n = Number.parseFloat(parts[1]);
			if (Number.isNaN(n)) return { type: "unknown", raw: input };
			return { type: "speed", multiplier: n };
		}
		case "/expand": {
			const n = Number.parseInt(parts[1], 10);
			if (Number.isNaN(n)) return { type: "unknown", raw: input };
			return { type: "expand", roundNumber: n };
		}
		case "/collapse": {
			const n = Number.parseInt(parts[1], 10);
			if (Number.isNaN(n)) return { type: "unknown", raw: input };
			return { type: "collapse", roundNumber: n };
		}
		case "/jump": {
			const arg1 = parts[1];
			if (!arg1) return { type: "unknown", raw: input };
			const directN = Number.parseInt(arg1, 10);
			if (!Number.isNaN(directN) && parts.length === 2) {
				return { type: "jump", target: "round", value: directN };
			}
			const target = arg1 as "round" | "turn";
			if (target !== "round" && target !== "turn")
				return { type: "unknown", raw: input };
			const value =
				target === "round" ? Number.parseInt(parts[2], 10) : parts[2];
			if (target === "round" && Number.isNaN(value as number))
				return { type: "unknown", raw: input };
			if (!value) return { type: "unknown", raw: input };
			return { type: "jump", target, value: value as number | string };
		}
		case "/top":
			return { type: "top" };
		case "/bottom":
			return { type: "bottom" };
		default:
			return { type: "unknown", raw: input };
	}
}

interface CommandInputProps {
	state: CommandState;
	onCommand: (cmd: ParsedCommand) => void;
}

export function CommandInput({
	state,
	onCommand,
}: CommandInputProps): React.ReactElement {
	const [input, setInput] = useState("");
	useInput((ch, key) => {
		if (key.return && input.trim().length > 0) {
			onCommand(parseCommand(input, state.mode));
			setInput("");
		} else if (key.backspace || key.delete) {
			setInput((prev) => prev.slice(0, -1));
		} else if (ch === "c" && key.ctrl) {
			onCommand({ type: "stop" });
		} else if (ch && !key.ctrl && !key.meta) {
			setInput((prev) => prev + ch);
		}
	});

	const PROMPTS: Record<string, string> = {
		approval: "approval> ",
		replay: "replay> ",
	};
	const prompt = PROMPTS[state.mode] ?? "> ";
	return (
		<Box>
			<Text>
				{prompt}
				{input}
			</Text>
		</Box>
	);
}
