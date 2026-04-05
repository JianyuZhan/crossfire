/**
 * Recursively freeze an object and all nested objects.
 * Used by preset and role-contract tables to ensure immutability at runtime.
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
	for (const value of Object.values(obj)) {
		if (value && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return Object.freeze(obj);
}
