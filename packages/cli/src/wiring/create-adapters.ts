import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import type { AdapterMap } from "@crossfire/orchestrator";
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
): Promise<AdapterBundle> {
	const started: Array<{ adapter: AgentAdapter; session: SessionHandle }> = [];

	async function startRole(role: ResolvedRole) {
		const adapter = factories[role.adapterType]();
		const session = await adapter.startSession({
			profile: role.profile.name,
			workingDirectory: process.cwd(),
			model: role.model,
			mcpServers: role.profile.mcp_servers,
			providerOptions: { systemPrompt: role.profile.systemPrompt },
		});
		started.push({ adapter, session });
		return { adapter, session };
	}

	try {
		const [proposer, challenger, judge] = await Promise.all([
			startRole(roles.proposer),
			startRole(roles.challenger),
			roles.judge ? startRole(roles.judge) : undefined,
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
