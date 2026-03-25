/** Loose type for SDK messages — we only parse fields we need */
export interface SdkMessage {
	type: string;
	[key: string]: unknown;
}

/** Result returned by the query function */
export interface QueryResult {
	messages: AsyncGenerator<SdkMessage, void, unknown>;
	interrupt: () => void;
}

/** Dependency-injected query function signature */
export type QueryFn = (options: {
	prompt: string;
	resume?: string;
	model?: string;
	canUseTool?: (tool: unknown) => Promise<unknown>;
	hooks?: unknown;
}) => QueryResult;
