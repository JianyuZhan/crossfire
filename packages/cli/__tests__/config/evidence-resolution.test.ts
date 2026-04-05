import { describe, expect, it } from "vitest";
import {
	type ResolvedEvidence,
	resolveRoleEvidence,
} from "../../src/config/evidence-resolution.js";

describe("resolveRoleEvidence", () => {
	it("CLI override wins over everything", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			cliEvidenceBar: "low",
			configEvidence: { bar: "high" },
			templateEvidence: { bar: "medium" },
		});
		expect(result).toEqual({ bar: "low", source: "cli" });
	});

	it("config inline wins over template", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			configEvidence: { bar: "high" },
			templateEvidence: { bar: "low" },
		});
		expect(result).toEqual({ bar: "high", source: "config" });
	});

	it("template override wins over role-default", () => {
		const result = resolveRoleEvidence({
			role: "proposer",
			templateEvidence: { bar: "low" },
			templateName: "strict",
		});
		expect(result).toEqual({ bar: "low", source: "template:strict" });
	});

	it("falls back to role-default when no override", () => {
		const result = resolveRoleEvidence({ role: "proposer" });
		expect(result).toEqual({ bar: undefined, source: "role-default" });
	});

	it("falls back to role-default when no override for challenger", () => {
		const result = resolveRoleEvidence({ role: "challenger" });
		expect(result).toEqual({ bar: undefined, source: "role-default" });
	});
});
