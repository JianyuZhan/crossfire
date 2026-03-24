import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyEvent, JudgeVerdict } from "@crossfire/orchestrator-core";

/** Strip internal meta-tool blocks from text for human-readable output */
function stripInternalBlocks(text: string): string {
  return text
    .replace(/```(?:debate_meta|judge_verdict)\s*[\s\S]*?```\s*/g, "")
    .replace(/```(?:debate_meta|judge_verdict)[\s\S]*$/g, "")
    .replace(/\n?(?:debate_meta|judge_verdict)\s*\n\s*\{[\s\S]*?\}\s*$/g, "")
    .trim();
}

export class TranscriptWriter {
  private readonly transcriptPath: string;
  private lines: string[] = [];
  private currentRound = 0;
  private currentSpeaker: string | undefined;

  constructor(outputDir: string) {
    this.transcriptPath = join(outputDir, "transcript.md");
  }

  handleEvent(event: AnyEvent): void {
    switch (event.kind) {
      case "debate.started": {
        const cfg = (event as { config: { topic: string } }).config;
        this.lines.push(`# Debate: ${cfg.topic}`, "");
        break;
      }
      case "round.started": {
        const e = event as { roundNumber: number; speaker: string };
        if (e.roundNumber !== this.currentRound) {
          this.currentRound = e.roundNumber;
          this.lines.push(`## Round ${e.roundNumber}`, "");
        }
        const label = e.speaker === "proposer" ? "Proposer" : "Challenger";
        this.currentSpeaker = label;
        this.lines.push(`### ${label}`, "");
        break;
      }
      case "message.final": {
        const e = event as { text: string };
        this.lines.push(stripInternalBlocks(e.text), "");
        break;
      }
      case "judge.completed": {
        const e = event as {
          roundNumber: number;
          verdict?: JudgeVerdict;
        };
        this.lines.push(`### Judge (Round ${e.roundNumber})`, "");
        if (e.verdict) {
          this.lines.push(
            `**Leading:** ${e.verdict.leading} (${e.verdict.score.proposer}:${e.verdict.score.challenger})`,
            "",
            e.verdict.reasoning,
            "",
            `**Continue:** ${e.verdict.shouldContinue ? "Yes" : "No"}`,
            "",
          );
        } else {
          this.lines.push("*Judge did not return a structured verdict.*", "");
        }
        break;
      }
      case "debate.completed": {
        const e = event as { reason: string };
        this.lines.push("---", "", `*Debate ended: ${e.reason}*`, "");
        break;
      }
      default:
        break;
    }
  }

  async close(): Promise<void> {
    writeFileSync(this.transcriptPath, this.lines.join("\n"));
  }
}
