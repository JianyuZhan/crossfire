import type { AdapterMap, DebateEventBus } from "@crossfire/orchestrator";
import type { ParsedCommand, TuiStore } from "@crossfire/tui";

type LiveCommand = ParsedCommand | { type: "quit" };

interface PendingApprovalLike {
	requestId: string;
	adapterId: string;
	adapterSessionId: string;
}

interface LiveCommandHandlerOptions {
	adapters: AdapterMap;
	bus: DebateEventBus;
	store: TuiStore;
	triggerShutdown: () => void;
	getUserQuitHandler?: () => (() => void) | undefined;
}

function findPendingApproval(
	store: TuiStore,
	requestId?: string,
): PendingApprovalLike | undefined {
	const pending = store.getState().command
		.pendingApprovals as PendingApprovalLike[];
	if (requestId) {
		return pending.find((approval) => approval.requestId === requestId);
	}
	return pending[0];
}

function findAdapterBySessionId(
	adapters: AdapterMap,
	adapterSessionId: string,
) {
	const entries = [adapters.proposer, adapters.challenger];
	if (adapters.judge) entries.push(adapters.judge);
	for (const entry of entries) {
		if (entry.session.adapterSessionId === adapterSessionId) {
			return entry.adapter;
		}
	}
	return undefined;
}

export function createLiveCommandHandler({
	adapters,
	bus,
	store,
	triggerShutdown,
	getUserQuitHandler,
}: LiveCommandHandlerOptions): (cmd: LiveCommand) => void {
	return (cmd: LiveCommand): void => {
		if (cmd.type === "quit") {
			getUserQuitHandler?.()?.();
			return;
		}

		if (cmd.type === "stop") {
			const quit = getUserQuitHandler?.();
			if (quit) {
				quit();
			} else {
				triggerShutdown();
			}
			return;
		}

		if (cmd.type === "approve" || cmd.type === "deny") {
			const pending = findPendingApproval(store, cmd.requestId);
			if (!pending) return;
			const adapter = findAdapterBySessionId(
				adapters,
				pending.adapterSessionId,
			);
			if (!adapter?.approve) return;
			void adapter.approve({
				requestId: pending.requestId,
				decision: cmd.type === "approve" ? "allow" : "deny",
			});
			return;
		}

		if (cmd.type === "inject-judge") {
			bus.push({
				kind: "user.inject",
				target: "judge",
				text: cmd.text,
				priority: "high",
				timestamp: Date.now(),
			});
			return;
		}

		if (cmd.type === "inject") {
			const targets =
				cmd.target === "both"
					? (["proposer", "challenger"] as const)
					: [cmd.target];
			for (const target of targets) {
				bus.push({
					kind: "user.inject",
					target,
					text: cmd.text,
					priority: cmd.priority,
					timestamp: Date.now(),
				});
			}
		}
	};
}
