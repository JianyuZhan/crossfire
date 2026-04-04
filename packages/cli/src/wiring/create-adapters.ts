import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import {
	type PolicyClampNote,
	type PolicyTranslationSummary,
	type PolicyTranslationWarning,
	type PresetSource,
	type ProviderObservationResult,
	type ResolvedPolicy,
	compilePolicyWithDiagnostics,
} from "@crossfire/adapter-core";
import type { AdapterId } from "@crossfire/adapter-core";
import type { AdapterMap } from "@crossfire/orchestrator";
import type {
	ResolvedAllRoles,
	ResolvedRoleRuntimeConfig,
} from "../config/resolver.js";
import { observePolicyForAdapter } from "./policy-observation.js";

export type AdapterFactory = () => AgentAdapter;
export type AdapterFactoryMap = Record<AdapterId, AdapterFactory>;

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

/**
 * Create adapters from ResolvedAllRoles (config-file path).
 * Each role already has its preset resolved.
 */
export async function createAdapters(
	resolvedRoles: ResolvedAllRoles,
	factories: AdapterFactoryMap,
): Promise<AdapterBundle> {
	const started: Array<{ adapter: AgentAdapter; session: SessionHandle }> = [];

	async function startResolvedRole(resolved: ResolvedRoleRuntimeConfig) {
		const diagnostics = compilePolicyWithDiagnostics({
			preset: resolved.preset.value,
			role: resolved.role,
		});
		const policy = diagnostics.policy;
		const observation = observePolicyForAdapter(
			resolved.adapter,
			policy,
			resolved.mcpServers,
		);

		const adapter = factories[resolved.adapter]();
		const session = await adapter.startSession({
			profile: resolved.bindingName,
			workingDirectory: process.cwd(),
			model: resolved.model,
			mcpServers: resolved.mcpServers,
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
			baselineClamps: diagnostics.clamps,
			baselinePreset: resolved.preset,
			baselineObservation: observation,
			legacyToolPolicyInput: undefined,
			observePolicy: (nextPolicy: ResolvedPolicy): ProviderObservationResult =>
				observePolicyForAdapter(
					resolved.adapter,
					nextPolicy,
					resolved.mcpServers,
				),
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
