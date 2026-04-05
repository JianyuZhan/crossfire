import type {
	AdapterId,
	AgentAdapter,
	PolicyTranslationWarning,
	ResolvedPolicy,
	SessionHandle,
	TurnInput,
} from "@crossfire/adapter-core";
import {
	CLAUDE_CAPABILITIES,
	CODEX_CAPABILITIES,
	GEMINI_CAPABILITIES,
	compilePolicy,
} from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import type { ClaudeNativeOptions } from "../../adapter-claude/src/policy-translation.js";
import { translatePolicy as translateClaudePolicy } from "../../adapter-claude/src/policy-translation.js";
import type { ResolvedAllRoles } from "../src/config/resolver.js";
import { createAdapters } from "../src/wiring/create-adapters.js";

const STUB_CAPABILITIES = {
	claude: CLAUDE_CAPABILITIES,
	codex: CODEX_CAPABILITIES,
	gemini: GEMINI_CAPABILITIES,
} as const;

type ClaudeTranslationRecord = {
	policy: ResolvedPolicy;
	native: ClaudeNativeOptions;
	warnings: readonly PolicyTranslationWarning[];
};

function makeStubAdapter(id: AdapterId): AgentAdapter {
	return {
		id,
		capabilities: STUB_CAPABILITIES[id],
		startSession: vi.fn().mockResolvedValue({
			adapterSessionId: `${id}-session`,
			providerSessionId: undefined,
			adapterId: id,
			transcript: [],
		} satisfies SessionHandle),
		sendTurn: vi.fn().mockResolvedValue({ turnId: "t1", status: "completed" }),
		onEvent: vi.fn().mockReturnValue(() => {}),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

function makeClaudeTranslatingStubAdapter(): {
	adapter: AgentAdapter;
	startTranslations: ClaudeTranslationRecord[];
	turnTranslations: ClaudeTranslationRecord[];
	turnCalls: TurnInput[];
} {
	const startTranslations: ClaudeTranslationRecord[] = [];
	const turnTranslations: ClaudeTranslationRecord[] = [];
	const turnCalls: TurnInput[] = [];
	const startSession: AgentAdapter["startSession"] = async (input) => {
		if (input.policy) {
			const translation = translateClaudePolicy(input.policy);
			startTranslations.push({
				policy: input.policy,
				native: translation.native,
				warnings: translation.warnings,
			});
		}
		return {
			adapterSessionId: "claude-session",
			providerSessionId: undefined,
			adapterId: "claude",
			transcript: [],
		};
	};
	const sendTurn: AgentAdapter["sendTurn"] = async (_handle, input) => {
		turnCalls.push(input);
		if (input.policy) {
			const translation = translateClaudePolicy(input.policy);
			turnTranslations.push({
				policy: input.policy,
				native: translation.native,
				warnings: translation.warnings,
			});
		}
		return { turnId: input.turnId, status: "completed" };
	};
	return {
		adapter: {
			id: "claude",
			capabilities: CLAUDE_CAPABILITIES,
			startSession: vi.fn(startSession),
			sendTurn: vi.fn(sendTurn),
			onEvent: vi.fn().mockReturnValue(() => {}),
			close: vi.fn().mockResolvedValue(undefined),
		},
		startTranslations,
		turnTranslations,
		turnCalls,
	};
}

function makeResolvedRole(
	role: "proposer" | "challenger" | "judge",
	adapter: AdapterId,
	preset: "research" | "guarded" | "dangerous" | "plan" = role === "judge"
		? "plan"
		: "guarded",
) {
	return {
		role,
		adapter,
		bindingName: `test-${role}`,
		model: undefined,
		preset: { value: preset, source: "role-default" as const },
		evidence: {
			bar: undefined,
			source: "role-default" as const,
		},
		interactionOverrides: undefined,
		templateName: undefined,
		templateBasePreset: undefined,
		systemPrompt: "test",
		providerOptions: undefined,
		mcpServers: undefined,
	};
}

function makeRoles(overrides?: {
	proposerPreset?: "research" | "guarded" | "dangerous" | "plan";
	challengerPreset?: "research" | "guarded" | "dangerous" | "plan";
}): ResolvedAllRoles {
	return {
		proposer: makeResolvedRole("proposer", "claude", overrides?.proposerPreset),
		challenger: makeResolvedRole(
			"challenger",
			"codex",
			overrides?.challengerPreset,
		),
		judge: makeResolvedRole("judge", "gemini"),
	};
}

function getStartSessionPolicy(adapter: AgentAdapter) {
	const calls = (adapter.startSession as ReturnType<typeof vi.fn>).mock.calls;
	return calls[0]?.[0]?.policy;
}

describe("policy wiring", () => {
	describe("baseline policy flow", () => {
		it("proposer receives guarded preset by default", async () => {
			const proposer = makeStubAdapter("claude");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => proposer,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			const policy = getStartSessionPolicy(proposer);
			expect(policy).toBeDefined();
			expect(policy.preset).toBe("guarded");
			expect(policy.capabilities.filesystem).toBe("write");
			expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(true);
			await bundle.closeAll();
		});

		it("challenger receives guarded preset by default", async () => {
			const challenger = makeStubAdapter("codex");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => challenger,
				gemini: () => makeStubAdapter("gemini"),
			});
			const policy = getStartSessionPolicy(challenger);
			expect(policy.preset).toBe("guarded");
			expect(policy.roleContract.semantics.mayIntroduceNewProposal).toBe(false);
			await bundle.closeAll();
		});

		it("judge default preset is plan, chosen in wiring not downstream", async () => {
			const judge = makeStubAdapter("gemini");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => judge,
			});
			const policy = getStartSessionPolicy(judge);
			expect(policy.preset).toBe("plan");
			expect(policy.interaction.approval).toBe("always");
			expect(policy.roleContract.semantics.exploration).toBe("forbidden");
			await bundle.closeAll();
		});

		it("custom presets flow into policy selection", async () => {
			const proposer = makeStubAdapter("claude");
			const challenger = makeStubAdapter("codex");
			const bundle = await createAdapters(
				makeRoles({
					proposerPreset: "research",
					challengerPreset: "dangerous",
				}),
				{
					claude: () => proposer,
					codex: () => challenger,
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			expect(getStartSessionPolicy(proposer).preset).toBe("research");
			expect(getStartSessionPolicy(challenger).preset).toBe("dangerous");
			await bundle.closeAll();
		});

		it("passes full MCP server definitions into startSession", async () => {
			const proposer = makeStubAdapter("claude");
			const roles = makeRoles();
			roles.proposer.mcpServers = {
				github: {
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-github"],
				},
			};

			const bundle = await createAdapters(roles, {
				claude: () => proposer,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});

			const calls = (proposer.startSession as ReturnType<typeof vi.fn>).mock
				.calls;
			expect(calls[0]?.[0]?.mcpServers).toEqual({
				github: {
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-github"],
				},
			});
			await bundle.closeAll();
		});

		it("baseline policy is stored on adapter entry", async () => {
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			expect(bundle.adapters.proposer.baselinePolicy).toBeDefined();
			expect(bundle.adapters.proposer.baselinePolicy?.preset).toBe("guarded");
			expect(bundle.adapters.challenger.baselinePolicy?.preset).toBe("guarded");
			expect(bundle.adapters.judge?.baselinePolicy?.preset).toBe("plan");
			await bundle.closeAll();
		});
	});

	describe("turn override flow", () => {
		it("adapter entry keeps baseline policy for downstream override compilation", async () => {
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			expect(bundle.adapters.proposer.baselinePolicy?.preset).toBe("guarded");
			await bundle.closeAll();
		});
	});

	describe("smoke", () => {
		it("baseline smoke: compile -> translate -> adapter startSession receives translated policy", async () => {
			const proposer = makeClaudeTranslatingStubAdapter();
			const bundle = await createAdapters(makeRoles(), {
				claude: () => proposer.adapter,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			const receivedPolicy = getStartSessionPolicy(proposer.adapter);
			expect(receivedPolicy).toBeDefined();
			expect(receivedPolicy.preset).toBe("guarded");
			expect(receivedPolicy.capabilities.filesystem).toBe("write");
			expect(proposer.startTranslations).toHaveLength(1);
			expect(proposer.startTranslations[0]?.policy.preset).toBe("guarded");
			expect(proposer.startTranslations[0]?.native.permissionMode).toBe(
				"default",
			);
			await bundle.closeAll();
		});

		it("turn override smoke: compile -> translate -> adapter sendTurn uses override while baseline stays clean", async () => {
			const proposer = makeClaudeTranslatingStubAdapter();
			const bundle = await createAdapters(makeRoles(), {
				claude: () => proposer.adapter,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});

			const baseline = bundle.adapters.proposer.baselinePolicy;
			expect(baseline).toBeDefined();
			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			const turnPolicy = compilePolicy({
				preset: "research",
				role: "proposer",
			});

			await bundle.adapters.proposer.adapter.sendTurn(
				bundle.sessions.proposer,
				{
					turnId: "p-override",
					prompt: "test prompt",
					policy: turnPolicy,
				},
			);

			expect(proposer.turnCalls).toHaveLength(1);
			expect(proposer.turnCalls[0]?.policy?.preset).toBe("research");
			expect(proposer.turnTranslations).toHaveLength(1);
			expect(proposer.turnTranslations[0]?.policy.preset).toBe("research");
			expect(proposer.turnTranslations[0]?.native.permissionMode).toBe(
				"default",
			);
			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			await bundle.closeAll();
		});
	});
});
