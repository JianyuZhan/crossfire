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
import type { ResolvedRoles } from "../src/profile/resolver.js";
import type { ProfileConfig } from "../src/profile/schema.js";
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

const makeProfile = (agent: ProfileConfig["agent"]): ProfileConfig => ({
	name: "test",
	agent,
	inherit_global_config: true,
	mcp_servers: {},
	allowed_tools: undefined,
	disallowed_tools: undefined,
	filePath: "/test.json",
});

function makeRoles(overrides?: {
	proposerProfile?: Partial<ProfileConfig>;
	challengerProfile?: Partial<ProfileConfig>;
	judgeProfile?: Partial<ProfileConfig> | null;
}): ResolvedRoles {
	return {
		proposer: {
			profile: { ...makeProfile("claude_code"), ...overrides?.proposerProfile },
			model: undefined,
			adapterType: "claude",
			systemPrompt: "test",
		},
		challenger: {
			profile: { ...makeProfile("codex"), ...overrides?.challengerProfile },
			model: undefined,
			adapterType: "codex",
			systemPrompt: "test",
		},
		judge:
			overrides?.judgeProfile === null
				? undefined
				: {
						profile: {
							...makeProfile("gemini_cli"),
							...overrides?.judgeProfile,
						},
						model: undefined,
						adapterType: "gemini",
						systemPrompt: "test",
					},
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

		it("custom execution modes flow into preset selection", async () => {
			const proposer = makeStubAdapter("claude");
			const challenger = makeStubAdapter("codex");
			const bundle = await createAdapters(
				makeRoles(),
				{
					claude: () => proposer,
					codex: () => challenger,
					gemini: () => makeStubAdapter("gemini"),
				},
				{ roleModes: { proposer: "research", challenger: "dangerous" } },
			);
			expect(getStartSessionPolicy(proposer).preset).toBe("research");
			expect(getStartSessionPolicy(challenger).preset).toBe("dangerous");
			await bundle.closeAll();
		});

		it("legacy allowed_tools flow into legacyToolOverrides", async () => {
			const proposer = makeStubAdapter("claude");
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: {
						allowed_tools: ["Read", "Grep"],
						disallowed_tools: ["WebFetch"],
					},
				}),
				{
					claude: () => proposer,
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			const policy = getStartSessionPolicy(proposer);
			expect(policy.capabilities.legacyToolOverrides).toEqual({
				allow: ["Read", "Grep"],
				deny: ["WebFetch"],
				source: "legacy-profile",
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

		it("legacyToolPolicyInput is stored on adapter entry", async () => {
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: { allowed_tools: ["Read"] },
				}),
				{
					claude: () => makeStubAdapter("claude"),
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			expect(bundle.adapters.proposer.legacyToolPolicyInput).toEqual({
				allow: ["Read"],
				deny: undefined,
			});
			expect(bundle.adapters.challenger.legacyToolPolicyInput).toBeUndefined();
			await bundle.closeAll();
		});
	});

	describe("turn override flow", () => {
		it("adapter entry keeps baseline policy and legacy tool input for downstream override compilation", async () => {
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: {
						allowed_tools: ["Read"],
						disallowed_tools: ["WebFetch"],
					},
				}),
				{
					claude: () => makeStubAdapter("claude"),
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);
			expect(bundle.adapters.proposer.baselinePolicy?.preset).toBe("guarded");
			expect(bundle.adapters.proposer.legacyToolPolicyInput).toEqual({
				allow: ["Read"],
				deny: ["WebFetch"],
			});
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
			const bundle = await createAdapters(
				makeRoles({
					proposerProfile: {
						allowed_tools: ["Read"],
						disallowed_tools: ["WebFetch"],
					},
				}),
				{
					claude: () => proposer.adapter,
					codex: () => makeStubAdapter("codex"),
					gemini: () => makeStubAdapter("gemini"),
				},
			);

			const baseline = bundle.adapters.proposer.baselinePolicy;
			expect(baseline).toBeDefined();
			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			const turnPolicy = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: bundle.adapters.proposer.legacyToolPolicyInput,
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
			expect(proposer.turnTranslations[0]?.native.allowedTools).toEqual([
				"Read",
			]);
			expect(proposer.turnTranslations[0]?.native.disallowedTools).toContain(
				"WebFetch",
			);
			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			await bundle.closeAll();
		});
	});
});
