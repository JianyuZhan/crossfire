// packages/tui/__tests__/state/viewport.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { TuiStore } from "../../src/state/tui-store.js";

describe("TuiStore viewport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with autoFollow=true and scrollOffset=0", () => {
    const store = new TuiStore();
    const vp = store.getViewport();
    expect(vp.autoFollow).toBe(true);
    expect(vp.scrollOffset).toBe(0);
  });

  it("scroll up sets autoFollow=false", () => {
    const store = new TuiStore();
    store.setViewportDimensions(20, 80);
    (store as any).globalLines = Array.from({ length: 50 }, () => ({
      segments: [],
      displayWidth: 0,
    }));
    store.scroll(-5);
    expect(store.getViewport().autoFollow).toBe(false);
    expect(store.getViewport().scrollOffset).toBe(5);
  });

  it("scroll down near bottom restores autoFollow", () => {
    const store = new TuiStore();
    store.setViewportDimensions(20, 80);
    (store as any).globalLines = Array.from({ length: 50 }, () => ({
      segments: [],
      displayWidth: 0,
    }));
    store.scroll(-10);
    expect(store.getViewport().autoFollow).toBe(false);
    store.scroll(9);
    expect(store.getViewport().autoFollow).toBe(true);
    expect(store.getViewport().scrollOffset).toBe(0);
  });

  it("scrollToTop sets offset to max", () => {
    const store = new TuiStore();
    store.setViewportDimensions(20, 80);
    (store as any).globalLines = Array.from({ length: 50 }, () => ({
      segments: [],
      displayWidth: 0,
    }));
    store.scrollToTop();
    expect(store.getViewport().scrollOffset).toBe(30); // 50-20
    expect(store.getViewport().autoFollow).toBe(false);
  });

  it("scrollToBottom restores autoFollow", () => {
    const store = new TuiStore();
    store.scroll(-10);
    store.scrollToBottom();
    expect(store.getViewport().scrollOffset).toBe(0);
    expect(store.getViewport().autoFollow).toBe(true);
  });

  it("getVisibleLines slices from bottom when offset=0", () => {
    const store = new TuiStore();
    store.setViewportDimensions(3, 80);
    const lines = Array.from({ length: 10 }, (_, i) => ({
      segments: [{ text: `line${i}`, style: {} }],
      displayWidth: 5,
    }));
    (store as any).globalLines = lines;
    const visible = store.getVisibleLines();
    expect(visible).toHaveLength(3);
    expect(visible[0].segments[0].text).toBe("line7");
    expect(visible[2].segments[0].text).toBe("line9");
  });
});
