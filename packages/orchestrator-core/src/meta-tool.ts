import { z } from "zod";

export const DebateMetaSchema = z.object({
	stance: z.enum([
		"strongly_agree",
		"agree",
		"neutral",
		"disagree",
		"strongly_disagree",
	]),
	confidence: z.number().min(0).max(1),
	key_points: z.array(z.string()),
	concessions: z.array(z.string()).optional(),
	wants_to_conclude: z.boolean().optional(),
	request_intervention: z
		.object({
			type: z.enum(["clarification", "arbitration"]),
			question: z.string(),
		})
		.optional(),
});

export type DebateMetaInput = z.infer<typeof DebateMetaSchema>;

export const JudgeVerdictSchema = z.object({
	leading: z.enum(["proposer", "challenger", "tie"]),
	score: z.object({ proposer: z.number(), challenger: z.number() }),
	reasoning: z.string(),
	should_continue: z.boolean(),
	repetition_score: z
		.object({
			proposer: z.number().min(0).max(1),
			challenger: z.number().min(0).max(1),
		})
		.optional(),
	clarification_response: z
		.object({
			answered: z.boolean(),
			answer: z.string().optional(),
			relay: z.string().optional(),
		})
		.optional(),
});

export type JudgeVerdictInput = z.infer<typeof JudgeVerdictSchema>;

export const DEBATE_META_TOOL = {
	name: "debate_meta" as const,
	description:
		"Report your current stance, confidence, key points, and concessions for this debate round.",
	inputSchema: DebateMetaSchema,
};

export const JUDGE_VERDICT_TOOL = {
	name: "judge_verdict" as const,
	description:
		"Evaluate the debate and provide your verdict on which side is leading.",
	inputSchema: JudgeVerdictSchema,
};
