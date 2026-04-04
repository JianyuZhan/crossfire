import { inspectClaudePolicy } from "@crossfire/adapter-claude";
import { inspectCodexPolicy } from "@crossfire/adapter-codex";
import type {
	AdapterId,
	ProviderObservationResult,
	ResolvedPolicy,
	ToolInspectionRecord,
} from "@crossfire/adapter-core";
import { inspectGeminiPolicy } from "@crossfire/adapter-gemini";
import type { McpServerConfig } from "../config/schema.js";

const adapterInspectors = {
	claude: inspectClaudePolicy,
	codex: inspectCodexPolicy,
	gemini: inspectGeminiPolicy,
} as const;

function buildAttachedMcpToolView(
	mcpServers?: Record<string, McpServerConfig>,
): ToolInspectionRecord[] {
	if (!mcpServers) return [];
	return Object.keys(mcpServers).map((serverName) => ({
		name: serverName,
		source: "mcp" as const,
		status: "unknown" as const,
		reason: "unknown" as const,
		details:
			"Configured MCP server attached; tool inventory is not enumerated in Phase C",
	}));
}

export function observePolicyForAdapter(
	adapter: AdapterId,
	policy: ResolvedPolicy,
	mcpServers?: Record<string, McpServerConfig>,
): ProviderObservationResult {
	const observation = adapterInspectors[adapter](policy);
	const attachedMcpToolView = buildAttachedMcpToolView(mcpServers);
	if (attachedMcpToolView.length === 0) {
		return observation;
	}
	return {
		...observation,
		toolView: [...observation.toolView, ...attachedMcpToolView],
	};
}
