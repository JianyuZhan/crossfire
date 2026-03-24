#!/usr/bin/env node
import { Command } from "commander";
import { replayCommand } from "./commands/replay.js";
import { resumeCommand } from "./commands/resume.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

const program = new Command()
	.name("crossfire")
	.description("AI agent debate orchestrator")
	.version("0.1.0");

program.addCommand(startCommand);
program.addCommand(resumeCommand);
program.addCommand(replayCommand);
program.addCommand(statusCommand);

program.parse();
