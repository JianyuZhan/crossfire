import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ProfileConfig, ProfileSchema } from "./schema.js";

export const DEFAULT_PROFILE_SEARCH_PATHS = [
	resolve("profiles", "providers"),
	join(
		process.env.HOME ?? process.env.USERPROFILE ?? "~",
		".config",
		"crossfire",
		"profiles",
		"providers",
	),
];

export function loadProfile(
	name: string,
	searchPaths: string[] = DEFAULT_PROFILE_SEARCH_PATHS,
): ProfileConfig {
	const filename = name.endsWith(".json") ? name : `${name}.json`;
	for (const dir of searchPaths) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) return parseProfileFile(filePath);
	}
	const searched = searchPaths.join(", ");
	const available = listAvailableProfiles(searchPaths);
	const hint =
		available.length > 0 ? ` Available profiles: ${available.join(", ")}` : "";
	throw new Error(`Profile "${name}" not found. Searched: ${searched}.${hint}`);
}

function parseProfileFile(filePath: string): ProfileConfig {
	const raw = readFileSync(filePath, "utf-8");
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Profile validation failed (${filePath}): invalid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const result = ProfileSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Profile validation failed (${filePath}): ${issues}`);
	}
	return { ...result.data, filePath };
}

function listAvailableProfiles(searchPaths: string[]): string[] {
	const profiles: string[] = [];
	for (const dir of searchPaths) {
		if (!existsSync(dir)) continue;
		collectProfiles(dir, "", profiles);
	}
	return profiles;
}

function collectProfiles(base: string, prefix: string, out: string[]): void {
	for (const entry of readdirSync(join(base, prefix), {
		withFileTypes: true,
	})) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			collectProfiles(base, rel, out);
		} else if (entry.name.endsWith(".json")) {
			out.push(rel.replace(/\.json$/, ""));
		}
	}
}
