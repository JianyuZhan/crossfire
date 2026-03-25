import { spawn } from "node:child_process";
import { ClaudeAdapter } from "@crossfire/adapter-claude";
import type { QueryFn } from "@crossfire/adapter-claude";
import { CODEX_TOOLS_DIR, CodexAdapter } from "@crossfire/adapter-codex";
import { GeminiAdapter } from "@crossfire/adapter-gemini";
import type { AdapterFactoryMap } from "./create-adapters.js";

export function createDefaultFactories(): AdapterFactoryMap {
	return {
		claude: () => {
			const sdkPromise = import("@anthropic-ai/claude-agent-sdk");
			let sdkQuery: typeof import("@anthropic-ai/claude-agent-sdk").query;

			const queryFn: QueryFn = (opts) => {
				async function* gen() {
					if (!sdkQuery) {
						const sdk = await sdkPromise;
						sdkQuery = sdk.query;
					}
					const q = sdkQuery({
						prompt: opts.prompt,
						options: {
							resume: opts.resume,
							model: opts.model,
							canUseTool: opts.canUseTool as never,
							hooks: opts.hooks as never,
							includePartialMessages: true,
						},
					});
					currentQuery = q;
					yield* q as AsyncGenerator<
						{ type: string; [key: string]: unknown },
						void,
						unknown
					>;
				}

				let currentQuery: { interrupt: () => void } | undefined;
				return {
					messages: gen(),
					interrupt: () => {
						currentQuery?.interrupt();
					},
				};
			};

			return new ClaudeAdapter({ queryFn });
		},
		codex: () =>
			new CodexAdapter({
				spawnFn: () => {
					const proc = spawn("codex", ["app-server"], {
						stdio: ["pipe", "pipe", "inherit"],
						env: {
							...process.env,
							PATH: `${CODEX_TOOLS_DIR}:${process.env.PATH}`,
						},
					});
					return {
						stdin: proc.stdin,
						stdout: proc.stdout,
					};
				},
			}),
		gemini: () => new GeminiAdapter(),
	};
}
