export interface AdapterCapabilities {
	supportsResume: boolean;
	resumeMode: "protocol-native" | "native-cli" | "stateless";
	resumeStability: "stable" | "experimental" | "none";
	supportsExternalHistoryInjection: boolean;
	supportsRawThinking: boolean;
	supportsReasoningSummary: boolean;
	supportsPlan: boolean;
	supportsApproval: boolean;
	supportsInterrupt: boolean;
	supportsSubagents: boolean;
	supportsStreamingDelta: boolean;
}

export const CLAUDE_CAPABILITIES: AdapterCapabilities = {
	supportsResume: true,
	resumeMode: "protocol-native",
	resumeStability: "stable",
	supportsExternalHistoryInjection: true,
	supportsRawThinking: true,
	supportsReasoningSummary: false,
	supportsPlan: false,
	supportsApproval: true,
	supportsInterrupt: true,
	supportsSubagents: true,
	supportsStreamingDelta: true,
};

export const CODEX_CAPABILITIES: AdapterCapabilities = {
	supportsResume: true,
	resumeMode: "protocol-native",
	resumeStability: "stable",
	supportsExternalHistoryInjection: true,
	supportsRawThinking: false,
	supportsReasoningSummary: true,
	supportsPlan: true,
	supportsApproval: true,
	supportsInterrupt: true,
	supportsSubagents: false,
	supportsStreamingDelta: true,
};

export const GEMINI_CAPABILITIES: AdapterCapabilities = {
	supportsResume: true,
	resumeMode: "native-cli",
	resumeStability: "experimental",
	supportsExternalHistoryInjection: true,
	supportsRawThinking: true,
	supportsReasoningSummary: false,
	supportsPlan: false,
	supportsApproval: false,
	supportsInterrupt: false,
	supportsSubagents: false,
	supportsStreamingDelta: true,
};
