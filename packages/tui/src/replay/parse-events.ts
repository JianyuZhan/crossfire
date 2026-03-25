import type { AnyEvent } from "@crossfire/orchestrator-core";

export function parseJsonlEvents(content: string): AnyEvent[] {
	return content
		.trim()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as AnyEvent);
}
