/** Subsequence fuzzy matching for the quick switcher. */

export type FuzzyResult = { score: number; positions: number[] };

/**
 * Match `query` as a subsequence of `text`. Higher scores for consecutive
 * runs, matches at word starts, and earlier matches. Null when it doesn't match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] };
  if (q.length > t.length) return null;

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let lastMatch = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    positions.push(idx);
    let bonus = 1;
    if (idx === lastMatch + 1) bonus += 3; // consecutive
    const prev = idx > 0 ? text[idx - 1] : "";
    if (idx === 0 || prev === "/" || prev === "\\" || prev === " " || prev === "-" || prev === "_" || prev === ".") {
      bonus += 3; // word start
    }
    score += bonus;
    lastMatch = idx;
    ti = idx + 1;
  }

  // Prefer earlier and tighter matches in shorter strings. The gap penalty must
  // outweigh word-start bonuses so a tight run beats letters scattered across
  // separators.
  score -= positions[0] * 0.05;
  score -= (positions[positions.length - 1] - positions[0] - q.length + 1) * 0.8;
  score -= text.length * 0.01;
  return { score, positions };
}

/** Score a file by name and full path, preferring basename matches. */
export function fuzzyScorePath(query: string, relName: string): number | null {
  const base = relName.split(/[\\/]/).pop() ?? relName;
  const onBase = fuzzyMatch(query, base);
  const onFull = fuzzyMatch(query, relName);
  if (!onBase && !onFull) return null;
  const baseScore = onBase ? onBase.score + 4 : -Infinity;
  const fullScore = onFull ? onFull.score : -Infinity;
  return Math.max(baseScore, fullScore);
}
