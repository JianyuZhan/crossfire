import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "@crossfire/adapter-core";
import { DebateEventBus } from "@crossfire/orchestrator";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedRoles } from "../src/profile/resolver.js";
import { createAdapters } from "../src/wiring/create-adapters.js";
import { createBus } from "../src/wiring/create-bus.js";
import { createTui } from "../src/wiring/create-tui.js";

function mockAdapter(id: string): AgentAdapter {
	return {
		id,
		capabilities: {} as any,
		startSession: vi.fn().mockResolvedValue({
			adapterSessionId: `${id}-session`,
			providerSessionId: undefined,
			adapterId: id as any,
			transcript: [],
		}),
		sendTurn: vi.fn().mockResolvedValue({ turnId: "t1", status: "completed" }),
		onEvent: vi.fn().mockReturnValue(() => {}),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

const makeProfile = (agent: string) => ({
	name: "test",
	agent: agent as any,
	inherit_global_config: true,
	mcp_servers: {},
	systemPrompt: "test",
	filePath: "/test.md",
});

describe("createAdapters", () => {
	it("creates adapter bundle for all three roles", async () => {
		const roles: ResolvedRoles = {
			proposer: {
				profile: makeProfile("claude_code"),
				model: undefined,
				adapterType: "claude",
			},
			challenger: {
				profile: makeProfile("codex"),
				model: undefined,
				adapterType: "codex",
			},
			judge: {
				profile: makeProfile("gemini_cli"),
				model: undefined,
				adapterType: "gemini",
			},
		};
		const bundle = await createAdapters(roles, {
			claude: () => mockAdapter("claude"),
			codex: () => mockAdapter("codex"),
			gemini: () => mockAdapter("gemini"),
		});
		expect(bundle.adapters.proposer).toBeDefined();
		expect(bundle.adapters.challenger).toBeDefined();
		expect(bundle.adapters.judge).toBeDefined();
		expect(bundle.sessions.proposer).toBeDefined();
		await bundle.closeAll();
	});

	it("skips judge when role is undefined", async () => {
		const roles: ResolvedRoles = {
			proposer: {
				profile: makeProfile("claude_code"),
				model: undefined,
				adapterType: "claude",
			},
			challenger: {
				profile: makeProfile("codex"),
				model: undefined,
				adapterType: "codex",
			},
			judge: undefined,
		};
		const bundle = await createAdapters(roles, {
			claude: () => mockAdapter("claude"),
			codex: () => mockAdapter("codex"),
			gemini: () => mockAdapter("gemini"),
		});
		expect(bundle.adapters.judge).toBeUndefined();
		await bundle.closeAll();
	});

	it("closeAll swallows individual errors", async () => {
		const failing = mockAdapter("claude");
		(failing.close as any).mockRejectedValue(new Error("close failed"));
		const roles: ResolvedRoles = {
			proposer: {
				profile: makeProfile("claude_code"),
				model: undefined,
				adapterType: "claude",
			},
			challenger: {
				profile: makeProfile("codex"),
				model: undefined,
				adapterType: "codex",
			},
			judge: undefined,
		};
		const bundle = await createAdapters(roles, {
			claude: () => failing,
			codex: () => mockAdapter("codex"),
			gemini: () => mockAdapter("gemini"),
		});
		await expect(bundle.closeAll()).resolves.toBeUndefined();
	});
});

describe("createBus", () => {
	it("creates bus without persistence when no outputDir", () => {
		const bundle = createBus({});
		expect(bundle.bus).toBeDefined();
		expect(bundle.eventStore).toBeUndefined();
	});

	it("creates bus with EventStore when outputDir given", () => {
		const dir = mkdtempSync(join(tmpdir(), "crossfire-bus-"));
		const bundle = createBus({ outputDir: dir });
		expect(bundle.bus).toBeDefined();
		expect(bundle.eventStore).toBeDefined();
	});
});

describe("createTui", () => {
	it("returns null when headless=true", () => {
		const bus = new DebateEventBus();
		const result = createTui(bus, true);
		expect(result).toBeNull();
	});
});
