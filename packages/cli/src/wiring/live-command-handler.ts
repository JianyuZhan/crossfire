import type { ApprovalOption } from "@crossfire/adapter-core";
import type { AdapterMap, DebateEventBus } from "@crossfire/orchestrator";
import type { ParsedCommand, TuiStore } from "@crossfire/tui";

type LiveCommand = ParsedCommand | { type: "quit" };

interface PendingApprovalLike {
	requestId: string;
	adapterId: string;
	adapterSessionId: string;
	options?: ApprovalOption[];
}

type ApprovalSelector =
	| { kind: "all" }
	| { kind: "index"; index: number }
	| { kind: "request"; requestId: string };

interface LiveCommandHandlerOptions {
	adapters: AdapterMap;
	bus: DebateEventBus;
	store: TuiStore;
	triggerShutdown: () => void;
	getUserQuitHandler?: () => (() => void) | undefined;
}

function findPendingApprovals(
	store: TuiStore,
	selector?: ApprovalSelector,
): PendingApprovalLike[] {
	const pending = store.getState().command
		.pendingApprovals as PendingApprovalLike[];

	if (!selector) {
		return pending[0] ? [pending[0]] : [];
	}

	switch (selector.kind) {
		case "all":
			return pending;
		case "index": {
			const approval = pending[selector.index - 1];
			return approval ? [approval] : [];
		}
		case "request": {
			const approval = pending.find(
				(entry) => entry.requestId === selector.requestId,
			);
			return approval ? [approval] : [];
		}
	}
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

function mapOptionKindToDecision(
	option: ApprovalOption,
	fallback: "approve" | "deny",
): "allow" | "deny" | "allow-always" {
	switch (option.kind) {
		case "deny":
			return "deny";
		case "allow-always":
			return "allow-always";
		case "allow":
			return "allow";
		case "other":
			return fallback === "deny" ? "deny" : "allow";
	}
}

function pickApprovalOption(
	approval: PendingApprovalLike,
	commandType: "approve" | "deny",
	optionIndex?: number,
): ApprovalOption | undefined {
	if (!approval.options || approval.options.length === 0) return undefined;
	if (optionIndex !== undefined) {
		return approval.options[optionIndex - 1];
	}
	if (commandType === "deny") {
		return (
			approval.options.find(
				(option) => option.isDefault && option.kind === "deny",
			) ?? approval.options.find((option) => option.kind === "deny")
		);
	}
	return (
		approval.options.find(
			(option) =>
				option.isDefault &&
				(option.kind === "allow" || option.kind === "allow-always"),
		) ??
		approval.options.find((option) => option.kind === "allow") ??
		approval.options.find((option) => option.kind === "allow-always")
	);
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

		if (cmd.type === "interrupt") {
			bus.push({
				kind: "turn.interrupt.requested",
				target: cmd.target,
				timestamp: Date.now(),
			});
			return;
		}

		if (cmd.type === "approve" || cmd.type === "deny") {
			const pending = findPendingApprovals(store, cmd.selector);
			if (pending.length === 0) return;
			for (const approval of pending) {
				const adapter = findAdapterBySessionId(
					adapters,
					approval.adapterSessionId,
				);
				if (!adapter?.approve) continue;
				const option = pickApprovalOption(approval, cmd.type, cmd.optionIndex);
				void adapter.approve({
					requestId: approval.requestId,
					decision: option
						? mapOptionKindToDecision(option, cmd.type)
						: cmd.type === "approve"
							? "allow"
							: "deny",
					optionId: option?.id,
				});
			}
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

		if (cmd.type === "pause") {
			bus.push({
				kind: "debate.paused",
				timestamp: Date.now(),
			});
			return;
		}

		if (cmd.type === "resume") {
			bus.push({
				kind: "debate.unpaused",
				timestamp: Date.now(),
			});
			return;
		}

		if (cmd.type === "extend") {
			const currentMaxRounds = store.getState().debateState.config.maxRounds;
			bus.push({
				kind: "debate.extended",
				by: cmd.rounds,
				newMaxRounds: currentMaxRounds + cmd.rounds,
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
