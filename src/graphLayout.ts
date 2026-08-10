/** A small deterministic force layout for the vault graph (no dependencies). */

export type LayoutPoint = { x: number; y: number };

/**
 * Position `count` nodes given undirected edges (index pairs). Nodes start on
 * a circle (deterministic — no randomness) and settle under three forces:
 * pairwise repulsion, spring attraction along edges, and a gentle pull to the
 * centre so disconnected clusters don't drift away.
 */
export function forceLayout(
  count: number,
  edges: [number, number][],
  iterations = 150,
): LayoutPoint[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0 }];

  const radius = 60 + count * 4;
  const pts: LayoutPoint[] = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    // A slight spiral breaks the symmetry that can trap a pure circle.
    const r = radius * (0.6 + 0.4 * ((i * 7919) % count) / count);
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });

  const springLength = 90;
  const repulsion = 6000;

  for (let iter = 0; iter < iterations; iter++) {
    const cool = 1 - iter / iterations;
    const fx = new Array<number>(count).fill(0);
    const fy = new Array<number>(count).fill(0);

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = pts[i].x - pts[j].x;
        let dy = pts[i].y - pts[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // Coincident points: separate deterministically by index.
          dx = 0.1 * (i - j);
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = repulsion / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f;
        fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f;
        fy[j] -= (dy / d) * f;
      }
    }

    for (const [a, b] of edges) {
      const dx = pts[b].x - pts[a].x;
      const dy = pts[b].y - pts[a].y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - springLength) * 0.05;
      fx[a] += (dx / d) * f;
      fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f;
      fy[b] -= (dy / d) * f;
    }

    for (let i = 0; i < count; i++) {
      fx[i] -= pts[i].x * 0.01;
      fy[i] -= pts[i].y * 0.01;
      const step = 6 * cool;
      const mag = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]) || 1;
      const cap = Math.min(mag, step * 10);
      pts[i].x += (fx[i] / mag) * cap * cool;
      pts[i].y += (fy[i] / mag) * cap * cool;
    }
  }
  return pts;
}

/** Bounding box of the layout with padding, as an SVG viewBox string. */
export function layoutViewBox(pts: LayoutPoint[], pad = 60): string {
  if (pts.length === 0) return "-200 -200 400 400";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(200, maxX - minX + pad * 2);
  const h = Math.max(200, maxY - minY + pad * 2);
  return `${minX - pad} ${minY - pad} ${w} ${h}`;
}
