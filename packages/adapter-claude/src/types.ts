export interface ClaudePermissionRule {
	toolName: string;
	ruleContent?: string;
}

export type ClaudePermissionUpdate =
	| {
			type: "addRules" | "replaceRules" | "removeRules";
			rules: ClaudePermissionRule[];
			behavior: "allow" | "deny" | "ask";
			destination:
				| "userSettings"
				| "projectSettings"
				| "localSettings"
				| "session"
				| "cliArg";
	  }
	| {
			type: "setMode";
			mode:
				| "default"
				| "acceptEdits"
				| "bypassPermissions"
				| "plan"
				| "delegate"
				| "dontAsk";
			destination:
				| "userSettings"
				| "projectSettings"
				| "localSettings"
				| "session"
				| "cliArg";
	  }
	| {
			type: "addDirectories" | "removeDirectories";
			directories: string[];
			destination:
				| "userSettings"
				| "projectSettings"
				| "localSettings"
				| "session"
				| "cliArg";
	  };

export type ClaudePermissionResult =
	| {
			behavior: "allow";
			updatedInput: Record<string, unknown>;
			updatedPermissions?: ClaudePermissionUpdate[];
	  }
	| {
			behavior: "deny";
			message: string;
			interrupt?: boolean;
	  };

export interface ClaudeCanUseToolOptions {
	toolUseID: string;
	signal?: AbortSignal;
	suggestions?: ClaudePermissionUpdate[];
	blockedPath?: string;
	decisionReason?: string;
	agentID?: string;
	[key: string]: unknown;
}

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
	canUseTool?: (
		toolName: string,
		toolInput: Record<string, unknown>,
		options: ClaudeCanUseToolOptions,
	) => Promise<ClaudePermissionResult>;
	hooks?: unknown;
}) => QueryResult;
