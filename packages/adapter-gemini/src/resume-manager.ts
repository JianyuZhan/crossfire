export interface BuildArgsInput {
	prompt: string;
	sessionId?: string;
	model?: string;
	forceStateless?: boolean;
}

export interface ValidateInitResult {
	valid: boolean;
	reason?: string;
}

export class ResumeManager {
	buildArgs(input: BuildArgsInput): string[] {
		const args: string[] = [];
		if (input.sessionId && !input.forceStateless) {
			args.push("--resume", input.sessionId);
		}
		if (input.model) {
			args.push("--model", input.model);
		}
		args.push("-p", input.prompt, "--output-format", "stream-json");
		return args;
	}

	validateInit(
		initEvent: Record<string, unknown>,
		expectedSessionId: string | undefined,
	): ValidateInitResult {
		const sessionId = initEvent.session_id;
		if (!sessionId || typeof sessionId !== "string") {
			return { valid: false, reason: "missing session_id in init event" };
		}
		if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
			return {
				valid: false,
				reason: `session_id mismatch: expected ${expectedSessionId}, got ${sessionId}`,
			};
		}
		return { valid: true };
	}
}
