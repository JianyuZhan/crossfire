import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { ClaudeAdapter } from "@crossfire/adapter-claude";
import type { QueryFn } from "@crossfire/adapter-claude";
import { CODEX_TOOLS_DIR, CodexAdapter } from "@crossfire/adapter-codex";
import type { AgentAdapter } from "@crossfire/adapter-core";
import { GeminiAdapter } from "@crossfire/adapter-gemini";
import { DebateEventBus, runDebate } from "@crossfire/orchestrator";
import type { DebateConfig } from "@crossfire/orchestrator-core";
import { beforeAll, describe, expect, it } from "vitest";

const SKIP = !process.env.RUN_INTEGRATION;

/**
 * Build a real QueryFn that delegates to the Claude Agent SDK.
 *
 * The SDK's query() returns a Query object which is itself an
 * AsyncGenerator<SDKMessage> with an interrupt() method. We map
 * that to the adapter's QueryResult shape.
 */
async function makeClaudeQueryFn(): Promise<QueryFn> {
	// Dynamic import because the SDK is optional / may not be in all envs
	const sdk = await import("@anthropic-ai/claude-agent-sdk");

	const queryFn: QueryFn = (opts) => {
		const q = sdk.query({
			prompt: opts.prompt,
			options: {
				resume: opts.resume,
				canUseTool: opts.canUseTool as never,
				hooks: opts.hooks as never,
				includePartialMessages: true,
				tools: [], // No tools for smoke test — pure debate
				maxTurns: 1,
				persistSession: false,
				systemPrompt:
					"You are a debate participant. Respond concisely in under 100 words.",
			},
		});
		return {
			messages: q as AsyncGenerator<
				{ type: string; [key: string]: unknown },
				void,
				unknown
			>,
			interrupt: () => {
				q.interrupt();
			},
		};
	};

	return queryFn;
}

/** Raw JSON-RPC notifications received from codex, for diagnostics */
const codexRawNotifications: Array<{ method: string; params: unknown }> = [];

function makeCodexAdapter(): AgentAdapter {
	return new CodexAdapter({
		spawnFn: () => {
			const proc = spawn("codex", ["app-server"], {
				stdio: ["pipe", "pipe", "inherit"],
				env: {
					...process.env,
					PATH: `${CODEX_TOOLS_DIR}:${process.env.PATH}`,
				},
			});
			// Tap stdout to capture raw JSON-RPC messages
			const tap = new PassThrough();
			proc.stdout.pipe(tap);
			proc.stdout.on("data", (chunk: Buffer) => {
				const lines = chunk.toString().split("\n").filter(Boolean);
				for (const line of lines) {
					try {
						const msg = JSON.parse(line);
						if (msg.method && msg.id === undefined) {
							codexRawNotifications.push({
								method: msg.method,
								params: msg.params,
							});
						}
					} catch {}
				}
			});
			return {
				stdin: proc.stdin,
				stdout: tap,
			};
		},
	});
}

function makeGeminiAdapter(): AgentAdapter {
	return new GeminiAdapter();
}

async function makeAdapter(
	type: string,
	claudeQueryFn?: QueryFn,
): Promise<AgentAdapter> {
	switch (type) {
		case "claude":
			if (!claudeQueryFn) throw new Error("claudeQueryFn required for claude");
			return new ClaudeAdapter({ queryFn: claudeQueryFn });
		case "codex":
			return makeCodexAdapter();
		case "gemini":
			return makeGeminiAdapter();
		default:
			throw new Error(`Unknown adapter: ${type}`);
	}
}

const TOPIC =
	"Should code reviews be mandatory? Keep response under 100 words.";
const CONFIG: DebateConfig = {
	topic: TOPIC,
	maxRounds: 1,
	judgeEveryNRounds: 0,
	convergenceThreshold: 0.3,
};

/**
 * Determine which combos to run based on env:
 *   RUN_INTEGRATION=1           → claude-only combos
 *   RUN_INTEGRATION=1 HAVE_CODEX=1 → full 4-combo matrix
 */
function getCombos(): Array<[string, string]> {
	const agents: string[] = ["claude"];
	if (process.env.HAVE_CODEX) agents.push("codex");
	if (process.env.HAVE_GEMINI) agents.push("gemini");
	const combos: Array<[string, string]> = [];
	for (const p of agents) {
		for (const c of agents) {
			combos.push([p, c]);
		}
	}
	return combos;
}

describe.skipIf(SKIP)("Headless smoke tests", () => {
	let claudeQueryFn: QueryFn | undefined;

	beforeAll(async () => {
		claudeQueryFn = await makeClaudeQueryFn();
	});

	for (const [proposer, challenger] of getCombos()) {
		it(`${proposer} vs ${challenger} completes 1 round`, async () => {
			const proposerAdapter = await makeAdapter(proposer, claudeQueryFn);
			const challengerAdapter = await makeAdapter(challenger, claudeQueryFn);

			const codexModel = process.env.CODEX_MODEL ?? "o3-mini";
			const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
			const modelFor = (agent: string) =>
				agent === "codex"
					? codexModel
					: agent === "gemini"
						? geminiModel
						: undefined;
			const proposerSession = await proposerAdapter.startSession({
				profile: "smoke-proposer",
				workingDirectory: process.cwd(),
				...(modelFor(proposer) ? { model: modelFor(proposer) } : {}),
			});
			const challengerSession = await challengerAdapter.startSession({
				profile: "smoke-challenger",
				workingDirectory: process.cwd(),
				...(modelFor(challenger) ? { model: modelFor(challenger) } : {}),
			});

			const bus = new DebateEventBus();

			// Collect events for debugging
			const events: Array<{ kind: string; turnId?: string }> = [];
			bus.subscribe((e) => {
				events.push({
					kind: e.kind,
					turnId: "turnId" in e ? (e as { turnId: string }).turnId : undefined,
				});
			});

			const state = await runDebate(
				CONFIG,
				{
					proposer: { adapter: proposerAdapter, session: proposerSession },
					challenger: {
						adapter: challengerAdapter,
						session: challengerSession,
					},
					judge: undefined,
				},
				{ bus },
			);

			// Log event summary for debugging
			console.log(
				`\n[${proposer} vs ${challenger}] Events:`,
				events.map((e) => e.kind).join(" → "),
			);
			console.log(`  Phase: ${state.phase}`);
			console.log(`  Reason: ${state.terminationReason}`);
			if (proposer === "codex" || challenger === "codex") {
				for (const n of codexRawNotifications) {
					console.log(`  [codex] ${n.method}:`, JSON.stringify(n.params));
				}
				codexRawNotifications.length = 0;
			}
			console.log(`  Turns: ${state.turns.length}`);

			expect(state.phase).toBe("completed");
			expect(["max-rounds", "convergence"]).toContain(state.terminationReason);
			expect(state.turns.length).toBeGreaterThanOrEqual(2);

			await proposerAdapter.close(proposerSession);
			await challengerAdapter.close(challengerSession);
		}, 120_000);
	}
});
