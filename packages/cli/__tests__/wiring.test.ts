import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "@crossfire/adapter-core";
import { DebateEventBus } from "@crossfire/orchestrator";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedAllRoles } from "../src/config/resolver.js";
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

function makeResolvedRole(
	role: "proposer" | "challenger" | "judge",
	adapter: "claude" | "codex" | "gemini",
) {
	return {
		role,
		adapter,
		bindingName: `test-${role}`,
		model: undefined,
		preset: {
			value: role === "judge" ? ("plan" as const) : ("guarded" as const),
			source: "role-default" as const,
		},
		systemPrompt: undefined,
		providerOptions: undefined,
		mcpServers: undefined,
	};
}

describe("createAdapters", () => {
	it("creates adapter bundle for all three roles", async () => {
		const roles: ResolvedAllRoles = {
			proposer: makeResolvedRole("proposer", "claude"),
			challenger: makeResolvedRole("challenger", "codex"),
			judge: makeResolvedRole("judge", "gemini"),
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
		const roles: ResolvedAllRoles = {
			proposer: makeResolvedRole("proposer", "claude"),
			challenger: makeResolvedRole("challenger", "codex"),
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

	it("passes compiled policy to adapter startSession", async () => {
		const roles: ResolvedAllRoles = {
			proposer: makeResolvedRole("proposer", "claude"),
			challenger: makeResolvedRole("challenger", "codex"),
			judge: makeResolvedRole("judge", "gemini"),
		};
		const mock = mockAdapter("claude");
		await createAdapters(roles, {
			claude: () => mock,
			codex: () => mockAdapter("codex"),
			gemini: () => mockAdapter("gemini"),
		});
		const startCall = (mock.startSession as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(startCall.policy).toBeDefined();
		expect(startCall.policy.preset).toBe("guarded");
		expect(
			startCall.policy.roleContract.semantics.mayIntroduceNewProposal,
		).toBe(true);
	});

	it("judge gets plan preset by default", async () => {
		const roles: ResolvedAllRoles = {
			proposer: makeResolvedRole("proposer", "claude"),
			challenger: makeResolvedRole("challenger", "codex"),
			judge: makeResolvedRole("judge", "gemini"),
		};
		const judgeMock = mockAdapter("gemini");
		await createAdapters(roles, {
			claude: () => mockAdapter("claude"),
			codex: () => mockAdapter("codex"),
			gemini: () => judgeMock,
		});
		const startCall = (judgeMock.startSession as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(startCall.policy.preset).toBe("plan");
		expect(startCall.policy.roleContract.semantics.exploration).toBe(
			"forbidden",
		);
	});

	it("closeAll swallows individual errors", async () => {
		const failing = mockAdapter("claude");
		(failing.close as any).mockRejectedValue(new Error("close failed"));
		const roles: ResolvedAllRoles = {
			proposer: makeResolvedRole("proposer", "claude"),
			challenger: makeResolvedRole("challenger", "codex"),
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
