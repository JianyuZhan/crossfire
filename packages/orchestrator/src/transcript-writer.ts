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

interface RoundData {
  roundNumber: number;
  speakers: Array<{
    role: "proposer" | "challenger";
    messageText: string;
  }>;
  judge?: {
    messageText: string;
    verdict?: JudgeVerdict;
  };
}

export class TranscriptWriter {
  private readonly transcriptPath: string;
  private topic = "";
  private rounds: RoundData[] = [];
  private currentRound: RoundData | undefined;
  private currentSpeaker: "proposer" | "challenger" | undefined;
  private judgeMessageText = "";
  private collectingJudge = false;

  constructor(outputDir: string) {
    this.transcriptPath = join(outputDir, "transcript.html");
  }

  handleEvent(event: AnyEvent): void {
    switch (event.kind) {
      case "debate.started": {
        this.topic = (event as { config: { topic: string } }).config.topic;
        break;
      }
      case "round.started": {
        const e = event as { roundNumber: number; speaker: string };
        if (
          !this.currentRound ||
          this.currentRound.roundNumber !== e.roundNumber
        ) {
          this.currentRound = { roundNumber: e.roundNumber, speakers: [] };
          this.rounds.push(this.currentRound);
        }
        this.currentSpeaker = e.speaker as "proposer" | "challenger";
        this.collectingJudge = false;
        break;
      }
      case "judge.started": {
        this.collectingJudge = true;
        this.judgeMessageText = "";
        break;
      }
      case "message.final": {
        const e = event as { text: string };
        if (this.collectingJudge) {
          this.judgeMessageText = stripInternalBlocks(e.text);
        } else if (this.currentRound && this.currentSpeaker) {
          this.currentRound.speakers.push({
            role: this.currentSpeaker,
            messageText: stripInternalBlocks(e.text),
          });
        }
        break;
      }
      case "judge.completed": {
        const e = event as { roundNumber: number; verdict?: JudgeVerdict };
        this.collectingJudge = false;
        const round = this.rounds.find((r) => r.roundNumber === e.roundNumber);
        if (round) {
          round.judge = {
            messageText: this.judgeMessageText,
            verdict: e.verdict,
          };
        }
        break;
      }
      case "debate.completed":
        break;
      default:
        break;
    }
  }

  async close(): Promise<void> {
    writeFileSync(this.transcriptPath, this.renderHtml());
  }

  private renderHtml(): string {
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
    const t = esc(this.topic);

    let body = "";
    for (const round of this.rounds) {
      body += `<div class="round"><h2>Round ${round.roundNumber}</h2>\n`;
      for (const speaker of round.speakers) {
        const isP = speaker.role === "proposer";
        const color = isP ? "#3498db" : "#e67e22";
        const label = isP ? "Proposer" : "Challenger";
        body += `<div class="speaker"><div class="speaker-label" style="color:${color}">${label}</div>`;
        body += `<div class="speaker-text" style="border-left-color:${color}">${esc(speaker.messageText)}</div></div>\n`;
      }
      if (round.judge) {
        body += `<div class="judge-block"><div class="judge-label">Judge</div>`;
        if (round.judge.messageText) {
          body += `<div class="judge-text">${esc(round.judge.messageText)}</div>`;
        }
        if (round.judge.verdict) {
          const v = round.judge.verdict;
          const decision = v.shouldContinue ? "Continue" : "End";
          const score = v.score
            ? ` | ${v.score.proposer}-${v.score.challenger}`
            : "";
          body += `<div class="judge-decision" style="color:${v.shouldContinue ? "#27ae60" : "#e74c3c"}">${decision}${score}</div>`;
        }
        body += `</div>\n`;
      }
      body += `</div>\n`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Transcript: ${t}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.7;color:#333;background:#fafafa}
h1{color:#1a1a2e;border-bottom:3px solid #6ec6ff;padding-bottom:.5rem}
h2{color:#2c5f8a;margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem;font-size:1.2rem}
.meta{color:#888;font-size:.85rem;margin-bottom:2rem}
.speaker{margin:.75rem 0}
.speaker-label{font-weight:700;margin-bottom:.25rem}
.speaker-text{padding:.5rem 0 .5rem 1rem;border-left:3px solid;color:#555;font-size:.95rem}
.judge-block{margin:.75rem 0;background:#fffde7;padding:.75rem 1rem;border-radius:6px}
.judge-label{font-weight:700;color:#f39c12}
.judge-text{color:#555;margin:.4rem 0;font-size:.95rem}
.judge-decision{font-weight:700;margin-top:.5rem}
</style></head>
<body>
<h1>Debate Transcript</h1>
<div class="meta">${t} · ${this.rounds.length} rounds</div>
${body}
</body></html>`;
  }
}
