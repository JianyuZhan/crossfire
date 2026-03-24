export interface ClarificationRequest {
	type: "clarification" | "arbitration";
	question: string;
}

export type ClarificationCategory =
	| "missing-fact"
	| "user-preference"
	| "ambiguous-requirement";

export interface ClarificationResult {
	allowed: boolean;
	category?: ClarificationCategory;
}

const TYPE_TO_CATEGORY: Record<string, ClarificationCategory> = {
	clarification: "missing-fact",
	arbitration: "user-preference",
};

export function evaluateClarification(
	request: ClarificationRequest,
): ClarificationResult {
	if (!request.question || request.question.trim().length === 0) {
		return { allowed: false };
	}

	const category = TYPE_TO_CATEGORY[request.type];
	if (!category) {
		return { allowed: false };
	}

	return { allowed: true, category };
}
