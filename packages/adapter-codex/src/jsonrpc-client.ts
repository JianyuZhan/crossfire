import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export class JsonRpcClient {
	private nextId = 1;
	private readonly pendingRequests: Map<
		number,
		{ resolve: (r: unknown) => void; reject: (e: Error) => void }
	> = new Map();
	private readonly notificationHandlers: Map<
		string,
		((...args: unknown[]) => void)[]
	> = new Map();
	private readonly requestHandlers: Map<
		string,
		(params: unknown) => Promise<unknown>
	> = new Map();
	private readonly errorHandlers: ((err: Error) => void)[] = [];
	private readonly writable: Writable;
	private readonly rl: ReturnType<typeof createInterface>;

	constructor(writable: Writable, readable: Readable) {
		this.writable = writable;
		this.rl = createInterface({ input: readable });
		this.rl.on("line", (line) => this.handleLine(line));

		// Propagate stream errors to registered error handlers
		readable.on("error", (err) => this.handleError(err));
	}

	/** Register an error handler for transport-level errors */
	onError(handler: (err: Error) => void): void {
		this.errorHandlers.push(handler);
	}

	/** Emit an error to all registered handlers */
	emitError(err: Error): void {
		this.handleError(err);
	}

	private handleError(err: Error): void {
		for (const handler of this.errorHandlers) {
			handler(err);
		}
		// Reject all pending requests
		for (const [, pending] of this.pendingRequests) {
			pending.reject(err);
		}
		this.pendingRequests.clear();
	}

	request(method: string, params?: unknown): Promise<unknown> {
		const id = this.nextId++;
		const msg = { jsonrpc: "2.0", id, method, params };
		this.writable.write(`${JSON.stringify(msg)}\n`);
		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
		});
	}

	notify(method: string, params?: unknown): void {
		const msg = { jsonrpc: "2.0", method, params };
		this.writable.write(`${JSON.stringify(msg)}\n`);
	}

	onNotification(method: string, handler: (...args: unknown[]) => void): void {
		const handlers = this.notificationHandlers.get(method) ?? [];
		handlers.push(handler);
		this.notificationHandlers.set(method, handlers);
	}

	onRequest(
		method: string,
		handler: (params: unknown) => Promise<unknown>,
	): void {
		this.requestHandlers.set(method, handler);
	}

	close(): void {
		this.rl.close();
		this.pendingRequests.clear();
	}

	private handleLine(line: string): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}

		const hasId = msg.id !== undefined;
		const hasMethod = typeof msg.method === "string";

		if (hasId && !hasMethod) {
			this.handleResponse(msg);
		} else if (hasId && hasMethod) {
			this.handleServerRequest(msg);
		} else if (hasMethod) {
			this.handleNotification(msg);
		}
	}

	private handleResponse(msg: Record<string, unknown>): void {
		const pending = this.pendingRequests.get(msg.id as number);
		if (!pending) return;
		this.pendingRequests.delete(msg.id as number);

		if (msg.error) {
			const err = msg.error as Record<string, unknown>;
			pending.reject(new Error(String(err.message)));
		} else {
			pending.resolve(msg.result);
		}
	}

	private handleServerRequest(msg: Record<string, unknown>): void {
		const handler = this.requestHandlers.get(msg.method as string);
		if (!handler) return;

		handler(msg.params).then(
			(result) => {
				this.writable.write(
					`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`,
				);
			},
			(err) => {
				this.writable.write(
					`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(err) } })}\n`,
				);
			},
		);
	}

	private handleNotification(msg: Record<string, unknown>): void {
		const method = msg.method as string;

		const handlers = this.notificationHandlers.get(method);
		if (handlers) {
			for (const h of handlers) h(msg.params);
		}

		const wildcardHandlers = this.notificationHandlers.get("*");
		if (wildcardHandlers) {
			for (const h of wildcardHandlers) h(method, msg.params);
		}
	}
}
