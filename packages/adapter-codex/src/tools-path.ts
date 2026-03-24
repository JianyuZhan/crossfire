import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the adapter-codex tools/ directory.
 * Add this to PATH when spawning the Codex app-server so that
 * meta-tool scripts (debate_meta, judge_verdict) are executable.
 */
export const CODEX_TOOLS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"tools",
);
