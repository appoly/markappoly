/**
 * Change review: compare the version of a document the reader last saw with
 * what's on disk now, and turn reader comments into feedback they can paste
 * back to whoever (or whatever) wrote it.
 */

import type { Heading } from "./headings";

export type Hunk = {
  kind: "added" | "changed" | "removed";
  /** 1-based first line in the current text (for "removed": the line after the gap). */
  start: number;
  /** 1-based last line in the current text; start - 1 for "removed". */
  end: number;
  /** The old lines this hunk replaced or removed. */
  before: string;
};

/**
 * Line diff (Myers, O((N+M)·D)) between the old and new text, grouped into
 * hunks. Blank lines are left out of the comparison: they don't render, and
 * as anchors they make the diff pair up unrelated paragraphs (an unchanged
 * heading would show as removed and re-added). Documents edited by agents are
 * usually rewritten in a few places, so D stays small even for long files.
 */
export function diffLines(oldText: string, newText: string): Hunk[] {
  const a = contentLines(oldText);
  const b = contentLines(newText);
  // Trim the common prefix and suffix first: cheap, and it keeps D tiny.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].text === b[pre].text) pre += 1;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf].text === b[b.length - 1 - suf].text
  )
    suf += 1;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const ops = myers(
    A.map((l) => l.text),
    B.map((l) => l.text),
  );
  const lastLine = splitLines(newText).length;

  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === "=") {
      ai += 1;
      bi += 1;
      k += 1;
      continue;
    }
    const aStart = ai;
    const bStart = bi;
    while (k < ops.length && ops[k] !== "=") {
      if (ops[k] === "-") ai += 1;
      else bi += 1;
      k += 1;
    }
    const removed = A.slice(aStart, ai).map((l) => l.text);
    const added = B.slice(bStart, bi);
    if (added.length === 0) {
      // A gap: anchor it to the next surviving line in the new text.
      const next = B[bStart] ?? b[pre + bStart];
      const start = next ? next.line : lastLine + 1;
      hunks.push({ kind: "removed", start, end: start - 1, before: removed.join("\n") });
    } else {
      hunks.push({
        kind: removed.length === 0 ? "added" : "changed",
        start: added[0].line,
        end: added[added.length - 1].line,
        before: removed.join("\n"),
      });
    }
  }
  return hunks;
}

/** Non-blank lines with their 1-based line numbers. */
function contentLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  splitLines(text).forEach((t, i) => {
    if (t.trim()) out.push({ text: t.trimEnd(), line: i + 1 });
  });
  return out;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

type Op = "=" | "-" | "+";

function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array<Op>(m).fill("+");
  if (m === 0) return Array<Op>(n).fill("-");
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a.length, b.length, offset);
    }
  }
  return [];
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("=");
      x -= 1;
      y -= 1;
    }
    if (d > 0) ops.push(x === prevX ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** The heading a 1-based source line sits under, if any. */
export function sectionFor(headings: Heading[], line: number): Heading | null {
  let found: Heading | null = null;
  for (const h of headings) {
    // Heading.line is 0-based (see headings.ts).
    if (h.line + 1 <= line) found = h;
    else break;
  }
  return found;
}

/** Distinct sections touched by a set of hunks, in document order. */
export function changedSections(headings: Heading[], hunks: Hunk[]): Heading[] {
  const seen = new Set<string>();
  const out: Heading[] = [];
  for (const h of hunks) {
    const s = sectionFor(headings, Math.max(1, h.start));
    const key = s ? s.slug : "";
    if (seen.has(key)) continue;
    seen.add(key);
    if (s) out.push(s);
  }
  return out;
}

/** A one-line summary like "3 changes in 2 sections". */
export function describeChanges(hunks: Hunk[], sections: number): string {
  const n = hunks.length;
  const changes = `${n} change${n === 1 ? "" : "s"}`;
  if (sections <= 1) return changes;
  return `${changes} in ${sections} sections`;
}

export type ReviewComment = {
  id: string;
  /** 1-based source line of the block the comment is anchored to. */
  line: number;
  /** The passage the reader selected (may be empty for block comments). */
  quote: string;
  text: string;
  created: number;
};

/**
 * Re-anchor comments after the document changes: if the quoted passage moved,
 * follow it to the nearest line that still contains its first line of text.
 * Returns -1 for comments whose passage is gone.
 */
export function relocateComment(source: string, c: ReviewComment): number {
  const lines = splitLines(source);
  const probe = firstWords(c.quote);
  if (!probe) return Math.min(c.line, lines.length);
  const at = (i: number) => i >= 0 && i < lines.length && normalise(lines[i]).includes(probe);
  // Blocks span several lines, so search outward from the stored anchor.
  for (let d = 0; d < lines.length; d++) {
    if (at(c.line - 1 + d)) return blockStart(lines, c.line - 1 + d) + 1;
    if (d > 0 && at(c.line - 1 - d)) return blockStart(lines, c.line - 1 - d) + 1;
  }
  return -1;
}

function blockStart(lines: string[], i: number): number {
  while (i > 0 && lines[i - 1].trim() !== "" && !/^\s*([-*+]|\d+[.)]|#{1,6}\s|>)/.test(lines[i])) i -= 1;
  return i;
}

function normalise(s: string): string {
  return s
    .replace(/[*_`~[\]()>#|=]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function firstWords(quote: string): string {
  const first = normalise(quote.split("\n").find((l) => l.trim()) ?? "");
  return first.split(" ").slice(0, 8).join(" ");
}

/**
 * Format comments as Markdown feedback, ordered by position, each with its
 * section and the quoted passage so the recipient can find it without line
 * numbers lining up.
 */
export function formatFeedback(opts: {
  path: string | null;
  name: string;
  comments: ReviewComment[];
  headings: Heading[];
}): string {
  const sorted = [...opts.comments].sort((a, b) => a.line - b.line || a.created - b.created);
  const lines: string[] = [];
  lines.push(`Feedback on \`${opts.path ?? opts.name}\`:`);
  lines.push("");
  sorted.forEach((c, i) => {
    const section = sectionFor(opts.headings, c.line);
    const where = section ? `§ ${section.text} (line ${c.line})` : `Line ${c.line}`;
    lines.push(`${i + 1}. **${where}**`);
    const quote = c.quote.trim();
    if (quote) {
      for (const q of quote.split("\n")) lines.push(`   > ${q}`.trimEnd());
      lines.push("");
    }
    for (const t of c.text.trim().split("\n")) lines.push(`   ${t}`.trimEnd());
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}
