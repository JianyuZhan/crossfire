import { describe, expect, it } from "vitest";
import {
	clampFilesystem,
	clampNetwork,
	clampShell,
	clampSubagents,
} from "../../src/policy/level-order.js";

describe("clampFilesystem", () => {
	it("returns base when no ceiling", () => {
		expect(clampFilesystem("write", undefined)).toBe("write");
	});
	it("returns base when base <= ceiling", () => {
		expect(clampFilesystem("read", "write")).toBe("read");
	});
	it("clamps base to ceiling when base > ceiling", () => {
		expect(clampFilesystem("write", "read")).toBe("read");
	});
	it("off clamp off = off", () => {
		expect(clampFilesystem("off", "off")).toBe("off");
	});
	it("write clamp off = off", () => {
		expect(clampFilesystem("write", "off")).toBe("off");
	});
});

describe("clampNetwork", () => {
	it("returns base when no ceiling", () => {
		expect(clampNetwork("full", undefined)).toBe("full");
	});
	it("full clamp search = search", () => {
		expect(clampNetwork("full", "search")).toBe("search");
	});
	it("search clamp fetch = search", () => {
		expect(clampNetwork("search", "fetch")).toBe("search");
	});
	it("fetch clamp search = search", () => {
		expect(clampNetwork("fetch", "search")).toBe("search");
	});
	it("off clamp full = off", () => {
		expect(clampNetwork("off", "full")).toBe("off");
	});
});

describe("clampShell", () => {
	it("exec clamp readonly = readonly", () => {
		expect(clampShell("exec", "readonly")).toBe("readonly");
	});
	it("readonly clamp off = off", () => {
		expect(clampShell("readonly", "off")).toBe("off");
	});
	it("off clamp exec = off", () => {
		expect(clampShell("off", "exec")).toBe("off");
	});
});

describe("clampSubagents", () => {
	it("on clamp off = off", () => {
		expect(clampSubagents("on", "off")).toBe("off");
	});
	it("off clamp on = off", () => {
		expect(clampSubagents("off", "on")).toBe("off");
	});
	it("on clamp undefined = on", () => {
		expect(clampSubagents("on", undefined)).toBe("on");
	});
});
