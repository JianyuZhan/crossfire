import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import {
	type LegacyToolPolicyInput,
	type PolicyPreset,
	compilePolicy,
} from "@crossfire/adapter-core";
import type { AdapterMap } from "@crossfire/orchestrator";
import type { DebateExecutionConfig } from "@crossfire/orchestrator-core";
import type {
	ResolvedAllRoles,
	ResolvedRoleRuntimeConfig,
} from "../config/resolver.js";
import type {
	AdapterType,
	ResolvedRole,
	ResolvedRoles,
} from "../profile/resolver.js";

export type AdapterFactory = () => AgentAdapter;
export type AdapterFactoryMap = Record<AdapterType, AdapterFactory>;

export interface SessionMap {
	proposer: SessionHandle;
	challenger: SessionHandle;
	judge?: SessionHandle;
}

export interface AdapterBundle {
	adapters: AdapterMap;
	sessions: SessionMap;
	closeAll(): Promise<void>;
}

export async function createAdapters(
	roles: ResolvedRoles,
	factories: AdapterFactoryMap,
	executionModes?: DebateExecutionConfig,
): Promise<AdapterBundle> {
	const started: Array<{ adapter: AgentAdapter; session: SessionHandle }> = [];

	async function startRole(
		roleName: "proposer" | "challenger" | "judge",
		role: ResolvedRole,
	) {
		const preset: PolicyPreset =
			roleName === "judge"
				? "plan"
				: ((executionModes?.roleModes?.[roleName] ??
						executionModes?.defaultMode ??
						"guarded") as PolicyPreset);

		const legacyToolPolicyInput: LegacyToolPolicyInput | undefined =
			role.profile.allowed_tools || role.profile.disallowed_tools
				? {
						allow: role.profile.allowed_tools,
						deny: role.profile.disallowed_tools,
					}
				: undefined;

		const policy = compilePolicy({
			preset,
			role: roleName,
			legacyToolPolicy: legacyToolPolicyInput,
		});

		const adapter = factories[role.adapterType]();
		const session = await adapter.startSession({
			profile: role.profile.name,
			workingDirectory: process.cwd(),
			model: role.model,
			mcpServers: role.profile.mcp_servers,
			policy,
			// Keep legacy fields for fallback during migration
			allowedTools: role.profile.allowed_tools,
			disallowedTools: role.profile.disallowed_tools,
			executionMode:
				roleName === "judge"
					? undefined
					: (executionModes?.roleModes?.[roleName] ??
						executionModes?.defaultMode),
			providerOptions: { systemPrompt: role.systemPrompt },
		});
		started.push({ adapter, session });
		return {
			adapter,
			session,
			baselinePolicy: policy,
			legacyToolPolicyInput,
		};
	}

	try {
		const [proposer, challenger, judge] = await Promise.all([
			startRole("proposer", roles.proposer),
			startRole("challenger", roles.challenger),
			roles.judge ? startRole("judge", roles.judge) : undefined,
		]);

		const adapters: AdapterMap = {
			proposer,
			challenger,
			judge,
		};

		const sessions: SessionMap = {
			proposer: proposer.session,
			challenger: challenger.session,
			judge: judge?.session,
		};

		const closeAll = async () => {
			await Promise.allSettled(
				started.map(({ adapter, session }) => adapter.close(session)),
			);
		};

		return { adapters, sessions, closeAll };
	} catch (error) {
		await Promise.allSettled(
			started.map(({ adapter, session }) => adapter.close(session)),
		);
		throw error;
	}
}

/**
 * Create adapters from ResolvedAllRoles (new config-file path).
 * Each role already has its preset resolved; no DebateExecutionConfig needed.
 */
export async function createAdaptersFromResolved(
	resolvedRoles: ResolvedAllRoles,
	factories: AdapterFactoryMap,
): Promise<AdapterBundle> {
	const started: Array<{ adapter: AgentAdapter; session: SessionHandle }> = [];

	async function startResolvedRole(resolved: ResolvedRoleRuntimeConfig) {
		const policy = compilePolicy({
			preset: resolved.preset.value,
			role: resolved.role,
		});

		const adapter = factories[resolved.adapter]();
		const session = await adapter.startSession({
			profile: resolved.bindingName,
			workingDirectory: process.cwd(),
			model: resolved.model,
			mcpServers: resolved.mcpServers
				? Object.fromEntries(resolved.mcpServers.map((s) => [s, {}]))
				: undefined,
			policy,
			providerOptions: {
				systemPrompt: resolved.systemPrompt,
				...resolved.providerOptions,
			},
		});
		started.push({ adapter, session });
		return {
			adapter,
			session,
			baselinePolicy: policy,
			legacyToolPolicyInput: undefined,
		};
	}

	try {
		const [proposer, challenger, judge] = await Promise.all([
			startResolvedRole(resolvedRoles.proposer),
			startResolvedRole(resolvedRoles.challenger),
			resolvedRoles.judge ? startResolvedRole(resolvedRoles.judge) : undefined,
		]);

		const adapters: AdapterMap = {
			proposer,
			challenger,
			judge,
		};

		const sessions: SessionMap = {
			proposer: proposer.session,
			challenger: challenger.session,
			judge: judge?.session,
		};

		const closeAll = async () => {
			await Promise.allSettled(
				started.map(({ adapter, session }) => adapter.close(session)),
			);
		};

		return { adapters, sessions, closeAll };
	} catch (error) {
		await Promise.allSettled(
			started.map(({ adapter, session }) => adapter.close(session)),
		);
		throw error;
	}
}
