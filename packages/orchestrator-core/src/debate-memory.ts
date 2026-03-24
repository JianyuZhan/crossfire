/**
 * Check whether a key point has been acknowledged by any concession.
 * Uses substring overlap on first 20 chars (case-insensitive).
 */
export function isAcknowledged(point: string, concessions: string[]): boolean {
	const pointLower = point.toLowerCase();
	const pointPrefix = pointLower.slice(0, 20);
	return concessions.some((c) => {
		const cLower = c.toLowerCase();
		return (
			cLower.includes(pointPrefix) || pointLower.includes(cLower.slice(0, 20))
		);
	});
}

/**
 * Given key points and concessions, return unresolved (unacknowledged) points.
 * Deduplicates by exact string match; stable order (input order preserved).
 */
export function filterUnresolved(
	keyPoints: string[],
	concessions: string[],
): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const point of keyPoints) {
		if (seen.has(point)) continue;
		seen.add(point);
		if (!isAcknowledged(point, concessions)) {
			result.push(point);
		}
	}
	return result;
}
