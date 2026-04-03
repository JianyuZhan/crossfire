import type {
	AdapterId,
	AgentAdapter,
	SessionHandle,
} from "@crossfire/adapter-core";
import {
	CLAUDE_CAPABILITIES,
	CODEX_CAPABILITIES,
	GEMINI_CAPABILITIES,
	compilePolicy,
} from "@crossfire/adapter-core";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedRoles } from "../src/profile/resolver.js";
import type { ProfileConfig } from "../src/profile/schema.js";
import { createAdapters } from "../src/wiring/create-adapters.js";

const STUB_CAPABILITIES = {
	claude: CLAUDE_CAPABILITIES,
	codex: CODEX_CAPABILITIES,
	gemini: GEMINI_CAPABILITIES,
} as const;

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
		it("compiling with different preset produces different policy", () => {
			const baseline = compilePolicy({ preset: "guarded", role: "proposer" });
			const turnOverride = compilePolicy({
				preset: "research",
				role: "proposer",
			});
			expect(baseline.preset).toBe("guarded");
			expect(turnOverride.preset).toBe("research");
			expect(baseline.capabilities.filesystem).toBe("write");
			expect(turnOverride.capabilities.filesystem).toBe("read");
		});

		it("turn override preserves legacy tool policy from baseline", () => {
			const legacyToolPolicy = { allow: ["Read"], deny: ["WebFetch"] };
			const baseline = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});
			const turnOverride = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy,
			});
			expect(baseline.capabilities.legacyToolOverrides?.allow).toEqual([
				"Read",
			]);
			expect(turnOverride.capabilities.legacyToolOverrides?.allow).toEqual([
				"Read",
			]);
			expect(turnOverride.preset).toBe("research");
		});

		it("turn override does not pollute baseline", () => {
			const legacyToolPolicy = { allow: ["Read"] };
			const baseline = compilePolicy({
				preset: "guarded",
				role: "proposer",
				legacyToolPolicy,
			});
			const _turnOverride = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy,
			});
			expect(baseline.preset).toBe("guarded");
			expect(baseline.capabilities.filesystem).toBe("write");
		});
	});

	describe("smoke", () => {
		it("baseline smoke: compile -> translate -> adapter receives policy", async () => {
			const policy = compilePolicy({ preset: "guarded", role: "proposer" });
			expect(policy.preset).toBe("guarded");
			expect(policy.capabilities).toBeDefined();
			expect(policy.interaction).toBeDefined();
			expect(policy.roleContract).toBeDefined();

			const adapter = makeStubAdapter("claude");
			const bundle = await createAdapters(makeRoles(), {
				claude: () => adapter,
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});
			const receivedPolicy = getStartSessionPolicy(adapter);
			expect(receivedPolicy).toBeDefined();
			expect(receivedPolicy.preset).toBe("guarded");
			expect(receivedPolicy.capabilities.filesystem).toBe("write");
			await bundle.closeAll();
		});

		it("turn override smoke: baseline stored, override takes precedence, baseline clean", async () => {
			const bundle = await createAdapters(makeRoles(), {
				claude: () => makeStubAdapter("claude"),
				codex: () => makeStubAdapter("codex"),
				gemini: () => makeStubAdapter("gemini"),
			});

			const baseline = bundle.adapters.proposer.baselinePolicy;
			expect(baseline).toBeDefined();
			expect(baseline?.preset).toBe("guarded");

			const turnPolicy = compilePolicy({
				preset: "research",
				role: "proposer",
				legacyToolPolicy: bundle.adapters.proposer.legacyToolPolicyInput,
			});
			expect(turnPolicy.preset).toBe("research");
			expect(turnPolicy.capabilities.filesystem).toBe("read");

			expect(baseline?.preset).toBe("guarded");
			expect(baseline?.capabilities.filesystem).toBe("write");

			await bundle.closeAll();
		});
	});
});
