#!/usr/bin/env node
/**
 * Diagnostic: capture raw JSON-RPC notification stream from codex app-server.
 *
 * Spawns `codex app-server` directly, performs initialize + thread/start +
 * turn/start handshake, then logs every JSON-RPC message with relative
 * timestamps. Highlights key timing events at the end.
 *
 * Usage:
 *   node packages/adapter-codex/diag-stream.mjs "Your prompt here"
 *   node packages/adapter-codex/diag-stream.mjs   # uses default prompt
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const prompt =
	process.argv[2] ||
	"Should code reviews be mandatory? Keep response under 100 words.";

function pad(ms) {
	return String(ms).padStart(6, " ");
}

console.log(`[diag] Prompt: "${prompt}"`);
console.log(`[diag] Spawning codex app-server...\n`);

const startTime = Date.now();
let rpcId = 0;
const pending = new Map(); // id -> resolve

const proc = spawn("codex", ["app-server"], {
	stdio: ["pipe", "pipe", "inherit"],
});

const rl = createInterface({ input: proc.stdout });

// Timeline collector
const timeline = [];
let deltaCount = 0;
let firstDelta = null;
let turnStartTime = null;

function send(method, params) {
	const id = ++rpcId;
	const msg = { jsonrpc: "2.0", id, method, params };
	proc.stdin.write(JSON.stringify(msg) + "\n");
	return new Promise((resolve) => pending.set(id, resolve));
}

function notify(method, params) {
	const msg = { jsonrpc: "2.0", method, params };
	proc.stdin.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
	const t = Date.now() - startTime;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		console.log(`[${pad(t)}] (non-JSON) ${line.slice(0, 120)}`);
		return;
	}

	// JSON-RPC response
	if (
		msg.id !== undefined &&
		(msg.result !== undefined || msg.error !== undefined)
	) {
		const resolve = pending.get(msg.id);
		if (resolve) {
			pending.delete(msg.id);
			resolve(msg.result || msg.error);
		}
		const brief = JSON.stringify(msg.result || msg.error).slice(0, 100);
		console.log(`[${pad(t)}] ← RESPONSE id=${msg.id}  ${brief}`);
		timeline.push({ t, method: "response", summary: brief });
		return;
	}

	// JSON-RPC request from server (e.g. approval)
	if (msg.id !== undefined && msg.method) {
		console.log(`[${pad(t)}] ← REQUEST ${msg.method} id=${msg.id}`);
		timeline.push({ t, method: `srv:${msg.method}`, summary: "" });
		// Auto-approve
		proc.stdin.write(
			JSON.stringify({
				jsonrpc: "2.0",
				id: msg.id,
				result: { approved: true },
			}) + "\n",
		);
		return;
	}

	// JSON-RPC notification
	if (msg.method) {
		const m = msg.method;
		const params = msg.params || {};
		let summary = "";

		if (m === "item/started" || m === "item/completed") {
			const item = params.item || params;
			summary = `type=${item.type || "?"}, id=${String(item.id || "").slice(0, 20)}`;
		} else if (m === "item/agentMessage/delta") {
			deltaCount++;
			summary = `"${(params.text || "").slice(0, 50)}"`;
			if (!firstDelta) firstDelta = t;
		} else if (m === "item/reasoning/summaryTextDelta") {
			summary = `"${(params.text || "").slice(0, 50)}"`;
		} else if (m === "turn/started") {
			turnStartTime = t;
			const turn = params.turn || params;
			summary = `id=${turn.id || "?"}, status=${turn.status || "?"}`;
		} else if (m === "turn/completed") {
			const turn = params.turn || params;
			summary = `status=${turn.status || "?"}`;
		} else if (m === "turn/plan/updated" || m === "item/plan/delta") {
			summary = JSON.stringify(params).slice(0, 80);
		} else if (m === "thread/tokenUsage/updated") {
			const usage = params.tokenUsage?.total || params;
			summary = `in=${usage.inputTokens || 0} out=${usage.outputTokens || 0}`;
		} else {
			summary = JSON.stringify(params).slice(0, 60);
		}

		// Print logic: skip most agentMessage/delta to keep output readable
		if (m === "item/agentMessage/delta") {
			if (deltaCount === 1 || deltaCount % 100 === 0) {
				console.log(`[${pad(t)}] ${m} #${deltaCount}  ${summary}`);
			}
		} else {
			console.log(`[${pad(t)}] ${m}  ${summary}`);
		}

		timeline.push({ t, method: m, summary });
	}
});

// Run the handshake sequence
async function run() {
	// 1. initialize
	const initResult = await send("initialize", {
		clientInfo: { name: "diag", title: "Diag", version: "0.0.1" },
		capabilities: { experimentalApi: true },
	});

	// 2. initialized
	notify("initialized");

	// 3. thread/start
	const threadResult = await send("thread/start", {
		model: process.env.CODEX_MODEL || "gpt-5.1-codex-mini",
		cwd: process.cwd(),
		approvalPolicy: "on-failure",
	});
	const threadId = threadResult?.thread?.id;
	console.log(`[${pad(Date.now() - startTime)}] Thread ID: ${threadId}\n`);

	// 4. turn/start
	await send("turn/start", {
		threadId,
		input: [{ type: "text", text: prompt }],
	});

	// Wait for turn/completed, then exit
	await new Promise((resolve) => {
		const check = setInterval(() => {
			const completed = timeline.find((e) => e.method === "turn/completed");
			if (completed) {
				clearInterval(check);
				resolve();
			}
		}, 200);
		// Timeout after 90s
		setTimeout(() => {
			clearInterval(check);
			resolve();
		}, 90000);
	});

	// Give a moment for any trailing messages
	await new Promise((r) => setTimeout(r, 500));
	printSummary();
	proc.kill("SIGTERM");
	process.exit(0);
}

function printSummary() {
	const elapsed = Date.now() - startTime;
	console.log(`\n${"=".repeat(70)}`);
	console.log(`[diag] Total elapsed: ${elapsed}ms`);
	console.log(`[diag] Total agentMessage/delta: ${deltaCount}`);
	if (turnStartTime !== null) {
		console.log(`[diag] turn/started at: ${turnStartTime}ms`);
	}
	if (firstDelta !== null) {
		const lastDelta = timeline
			.filter((e) => e.method === "item/agentMessage/delta")
			.pop();
		console.log(`[diag] First agentMessage/delta at: ${firstDelta}ms`);
		console.log(`[diag] Last agentMessage/delta at: ${lastDelta?.t}ms`);
		console.log(
			`[diag] Delta burst duration: ${(lastDelta?.t || 0) - firstDelta}ms`,
		);
		if (turnStartTime !== null) {
			console.log(
				`[diag] Gap (turn/started → first delta): ${firstDelta - turnStartTime}ms`,
			);
		}
	}

	// Key timeline
	console.log(`\n--- Key Event Timeline ---`);
	const interesting = timeline.filter(
		(e) =>
			e.method === "turn/started" ||
			e.method === "turn/completed" ||
			e.method === "turn/plan/updated" ||
			e.method === "item/plan/delta" ||
			e.method === "item/reasoning/summaryTextDelta" ||
			e.method === "item/started" ||
			e.method === "item/completed" ||
			e.method === "thread/tokenUsage/updated" ||
			e.method.startsWith("srv:"),
	);

	// Add first/last delta
	const allDeltas = timeline.filter(
		(e) => e.method === "item/agentMessage/delta",
	);
	if (allDeltas.length > 0) {
		interesting.push({
			...allDeltas[0],
			method: ">>> FIRST agentMessage/delta",
		});
		interesting.push({
			...allDeltas[allDeltas.length - 1],
			method: `>>> LAST agentMessage/delta (#${deltaCount})`,
		});
	}

	interesting.sort((a, b) => a.t - b.t);
	for (const e of interesting) {
		console.log(`  ${pad(e.t)}ms  ${e.method}  ${e.summary}`);
	}

	// Check what's missing
	console.log(`\n--- Missing Events ---`);
	const methods = new Set(timeline.map((e) => e.method));
	const expected = [
		"turn/started",
		"item/reasoning/summaryTextDelta",
		"turn/plan/updated",
		"item/plan/delta",
		"item/agentMessage/delta",
		"turn/completed",
	];
	for (const m of expected) {
		if (!methods.has(m)) {
			console.log(`  ✗ ${m} — NOT received`);
		} else {
			const count = timeline.filter((e) => e.method === m).length;
			console.log(`  ✓ ${m} — ${count} event(s)`);
		}
	}
}

run().catch((err) => {
	console.error("[diag] Fatal:", err);
	proc.kill("SIGTERM");
	process.exit(1);
});
