import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/components/command-input.js";

describe("parseCommand", () => {
	it("parses /stop", () => {
		expect(parseCommand("/stop", "normal")).toEqual({ type: "stop" });
	});
	it("parses /inject proposer with text", () => {
		expect(parseCommand("/inject proposer Please elaborate", "normal")).toEqual(
			{
				type: "inject",
				target: "proposer",
				text: "Please elaborate",
				priority: "normal",
			},
		);
	});
	it("parses /inject challenger with text", () => {
		expect(
			parseCommand("/inject challenger Be more specific", "normal"),
		).toEqual({
			type: "inject",
			target: "challenger",
			text: "Be more specific",
			priority: "normal",
		});
	});
	it("parses /extend N", () => {
		expect(parseCommand("/extend 5", "normal")).toEqual({
			type: "extend",
			rounds: 5,
		});
	});
	it("parses /pause and /resume", () => {
		expect(parseCommand("/pause", "normal")).toEqual({ type: "pause" });
		expect(parseCommand("/resume", "normal")).toEqual({ type: "resume" });
	});
	it("parses /interrupt with and without explicit target", () => {
		expect(parseCommand("/interrupt", "normal")).toEqual({
			type: "interrupt",
			target: "current",
		});
		expect(parseCommand("/interrupt proposer", "normal")).toEqual({
			type: "interrupt",
			target: "proposer",
		});
		expect(parseCommand("/interrupt judge", "normal")).toEqual({
			type: "interrupt",
			target: "judge",
		});
	});
	it("parses /approve in approval mode", () => {
		expect(parseCommand("/approve", "approval")).toEqual({ type: "approve" });
		expect(parseCommand("/approve ar-1", "approval")).toEqual({
			type: "approve",
			selector: { kind: "request", requestId: "ar-1" },
		});
		expect(parseCommand("/approve 2", "approval")).toEqual({
			type: "approve",
			selector: { kind: "index", index: 2 },
		});
		expect(parseCommand("/approve all", "approval")).toEqual({
			type: "approve",
			selector: { kind: "all" },
		});
		expect(parseCommand("/approve 1 2", "approval")).toEqual({
			type: "approve",
			selector: { kind: "index", index: 1 },
			optionIndex: 2,
		});
	});
	it("parses /deny in approval mode", () => {
		expect(parseCommand("/deny", "approval")).toEqual({ type: "deny" });
		expect(parseCommand("/deny 3", "approval")).toEqual({
			type: "deny",
			selector: { kind: "index", index: 3 },
		});
		expect(parseCommand("/deny all", "approval")).toEqual({
			type: "deny",
			selector: { kind: "all" },
		});
	});
	it("parses /speed in replay mode", () => {
		expect(parseCommand("/speed 5", "replay")).toEqual({
			type: "speed",
			multiplier: 5,
		});
	});
	it("parses /jump round N in replay mode", () => {
		expect(parseCommand("/jump round 3", "replay")).toEqual({
			type: "jump",
			target: "round",
			value: 3,
		});
	});
	it("returns unknown for invalid input", () => {
		expect(parseCommand("/invalid", "normal")).toEqual({
			type: "unknown",
			raw: "/invalid",
		});
	});
	it("parses /status policy", () => {
		const result = parseCommand("/status policy", "live");
		expect(result).toEqual({ type: "status", target: "policy" });
	});
	it("parses /status tools", () => {
		const result = parseCommand("/status tools", "live");
		expect(result).toEqual({ type: "status", target: "tools" });
	});
	it("returns unknown for /status without target", () => {
		const result = parseCommand("/status", "live");
		expect(result).toEqual({ type: "unknown", raw: "/status" });
	});
});
