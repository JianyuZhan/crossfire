import type { AgentAdapter, SessionHandle } from "@crossfire/adapter-core";
import type { AdapterMap } from "@crossfire/orchestrator";
import type { DebateExecutionConfig } from "@crossfire/orchestrator-core";
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
		const adapter = factories[role.adapterType]();
		const session = await adapter.startSession({
			profile: role.profile.name,
			workingDirectory: process.cwd(),
			model: role.model,
			mcpServers: role.profile.mcp_servers,
			executionMode:
				roleName === "judge"
					? undefined
					: (executionModes?.roleModes?.[roleName] ??
						executionModes?.defaultMode),
			providerOptions: { systemPrompt: role.systemPrompt },
		});
		started.push({ adapter, session });
		return { adapter, session };
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
