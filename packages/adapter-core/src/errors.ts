// packages/adapter-core/src/errors.ts

export class AdapterError extends Error {
	constructor(
		message: string,
		public readonly adapterId: string,
		public readonly recoverable: boolean = false,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "AdapterError";
	}
}

export class ResumeError extends AdapterError {
	constructor(
		adapterId: string,
		public readonly sessionId: string,
		cause?: unknown,
	) {
		super(`Resume failed for session ${sessionId}`, adapterId, true, cause);
		this.name = "ResumeError";
	}
}

export class ApprovalTimeoutError extends AdapterError {
	constructor(
		adapterId: string,
		public readonly requestId: string,
	) {
		super(`Approval timed out for request ${requestId}`, adapterId, false);
		this.name = "ApprovalTimeoutError";
	}
}

export class TransportError extends AdapterError {
	constructor(adapterId: string, message: string, cause?: unknown) {
		super(message, adapterId, true, cause);
		this.name = "TransportError";
	}
}
