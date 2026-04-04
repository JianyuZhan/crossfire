export function formatWarningBadge(count: number): string {
	if (count === 0) return "";
	return ` ⚠${count}`;
}
