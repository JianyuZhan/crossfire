import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JsonRpcClient } from "../src/jsonrpc-client.js";

describe("JsonRpcClient", () => {
	let stdin: PassThrough;
	let stdout: PassThrough;
	let client: JsonRpcClient;

	beforeEach(() => {
		stdin = new PassThrough();
		stdout = new PassThrough();
		client = new JsonRpcClient(stdin, stdout);
	});

	it("sends JSON-RPC request and receives response", async () => {
		const responsePromise = client.request("initialize", {
			clientInfo: { name: "test" },
		});
		const written = await new Promise<string>((r) =>
			stdin.once("data", (d) => r(d.toString())),
		);
		const req = JSON.parse(written);
		expect(req.jsonrpc).toBe("2.0");
		expect(req.method).toBe("initialize");
		expect(req.id).toBeDefined();
		expect(req.params).toEqual({ clientInfo: { name: "test" } });
		// Send response
		stdout.write(
			JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: true } }) +
				"\n",
		);
		const result = await responsePromise;
		expect(result).toEqual({ ok: true });
	});

	it("sends notification (no id, no response expected)", async () => {
		client.notify("initialized", {});
		const written = await new Promise<string>((r) =>
			stdin.once("data", (d) => r(d.toString())),
		);
		const msg = JSON.parse(written);
		expect(msg.jsonrpc).toBe("2.0");
		expect(msg.method).toBe("initialized");
		expect(msg.id).toBeUndefined();
	});

	it("dispatches server notifications to handler", async () => {
		const handler = vi.fn();
		client.onNotification("item/agentMessage/delta", handler);
		stdout.write(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "item/agentMessage/delta",
				params: { text: "hi" },
			}) + "\n",
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledWith({ text: "hi" });
	});

	it("handles server-initiated requests (approval)", async () => {
		client.onRequest(
			"item/commandExecution/requestApproval",
			async (params) => {
				return { approved: true };
			},
		);
		stdout.write(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 99,
				method: "item/commandExecution/requestApproval",
				params: { command: "rm" },
			}) + "\n",
		);
		await new Promise((r) => setTimeout(r, 50));
		const written = await new Promise<string>((r) =>
			stdin.once("data", (d) => r(d.toString())),
		);
		const resp = JSON.parse(written);
		expect(resp.jsonrpc).toBe("2.0");
		expect(resp.id).toBe(99);
		expect(resp.result).toEqual({ approved: true });
	});

	it("handles JSON-RPC error response", async () => {
		const responsePromise = client.request("bad-method", {});
		const written = await new Promise<string>((r) =>
			stdin.once("data", (d) => r(d.toString())),
		);
		const req = JSON.parse(written);
		stdout.write(
			JSON.stringify({
				jsonrpc: "2.0",
				id: req.id,
				error: { code: -32601, message: "Method not found" },
			}) + "\n",
		);
		await expect(responsePromise).rejects.toThrow("Method not found");
	});

	it("supports wildcard notification handler", async () => {
		const handler = vi.fn();
		client.onNotification("*", handler);
		stdout.write(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "some/event",
				params: { a: 1 },
			}) + "\n",
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledWith("some/event", { a: 1 });
	});

	it("close() cleans up resources", () => {
		client.close();
		// Should not throw on close
	});
});
