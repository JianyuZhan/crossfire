import { describe, expect, it } from "vitest";
import { RealTimeClock, ScaledClock } from "../src/replay/playback-clock.js";

describe("RealTimeClock", () => {
	it("has speed 1 and not paused", () => {
		const clock = new RealTimeClock();
		expect(clock.speed).toBe(1);
		expect(clock.paused).toBe(false);
	});

	it("delay resolves immediately", async () => {
		const clock = new RealTimeClock();
		const start = Date.now();
		await clock.delay(1000);
		expect(Date.now() - start).toBeLessThan(50);
	});
});

describe("ScaledClock", () => {
	it("applies speed multiplier to delay", async () => {
		const clock = new ScaledClock(10);
		const start = Date.now();
		await clock.delay(500); // 500ms / 10 = 50ms
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(30);
		expect(elapsed).toBeLessThan(150);
	});

	it("clamps large deltas to 5000ms before applying speed", async () => {
		const clock = new ScaledClock(100);
		const start = Date.now();
		await clock.delay(30000); // Clamped to 5000 / 100 = 50ms
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(200);
	});

	it("delivers immediately for near-zero deltas", async () => {
		const clock = new ScaledClock(1);
		const start = Date.now();
		await clock.delay(5); // < 10ms threshold
		expect(Date.now() - start).toBeLessThan(20);
	});

	it("supports pause and resume", async () => {
		const clock = new ScaledClock(1);
		clock.pause();
		expect(clock.paused).toBe(true);
		let resolved = false;
		const p = clock.delay(100).then(() => {
			resolved = true;
		});
		await new Promise((r) => setTimeout(r, 150));
		expect(resolved).toBe(false);
		clock.resume();
		await p;
		expect(resolved).toBe(true);
	});

	it("allows speed change", () => {
		const clock = new ScaledClock(1);
		clock.setSpeed(5);
		expect(clock.speed).toBe(5);
	});
});
