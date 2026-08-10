import { describe, expect, it } from "vitest";
import { forceLayout, layoutViewBox } from "./graphLayout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("forceLayout", () => {
  it("handles empty and single-node graphs", () => {
    expect(forceLayout(0, [])).toEqual([]);
    expect(forceLayout(1, [])).toEqual([{ x: 0, y: 0 }]);
  });

  it("returns finite, non-overlapping positions", () => {
    const pts = forceLayout(30, [[0, 1], [1, 2], [2, 0]]);
    expect(pts).toHaveLength(30);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(dist(pts[i], pts[j])).toBeGreaterThan(1);
      }
    }
  });

  it("is deterministic", () => {
    const a = forceLayout(12, [[0, 1], [4, 5]]);
    const b = forceLayout(12, [[0, 1], [4, 5]]);
    expect(a).toEqual(b);
  });

  it("pulls linked nodes closer than the average pair", () => {
    const edges: [number, number][] = [[0, 1]];
    const pts = forceLayout(20, edges, 300);
    const linked = dist(pts[0], pts[1]);
    let total = 0;
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        total += dist(pts[i], pts[j]);
        n++;
      }
    }
    expect(linked).toBeLessThan(total / n);
  });
});

describe("layoutViewBox", () => {
  it("covers every point", () => {
    const pts = [
      { x: -50, y: 10 },
      { x: 120, y: -80 },
    ];
    const [x, y, w, h] = layoutViewBox(pts).split(" ").map(Number);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(x);
      expect(p.y).toBeGreaterThan(y);
      expect(p.x).toBeLessThan(x + w);
      expect(p.y).toBeLessThan(y + h);
    }
  });
});
