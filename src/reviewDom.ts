import type { Hunk, ReviewComment } from "./review";

/**
 * Decorate the rendered preview with review state. Everything goes through
 * data-* attributes (and `title` tooltips we tag as ours), which React never
 * manages on Markdown output, so re-renders and our marks can't fight.
 */

type Block = { el: HTMLElement; start: number; end: number };

function topBlocks(root: HTMLElement): Block[] {
  const els = Array.from(root.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.sourceLine,
  );
  return els.map((el, i) => ({
    el,
    start: Number(el.dataset.sourceLine),
    end: i + 1 < els.length ? Number(els[i + 1].dataset.sourceLine) - 1 : Infinity,
  }));
}

const clip = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

export function clearReviewMarks(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>("[data-review],[data-review-removed],[data-comment]")
    .forEach((el) => {
      delete el.dataset.review;
      delete el.dataset.reviewRemoved;
      delete el.dataset.comment;
      if (el.dataset.reviewTitle) {
        el.removeAttribute("title");
        delete el.dataset.reviewTitle;
      }
    });
}

/**
 * Mark changed blocks and removal points. Returns, per hunk, the element to
 * scroll to when stepping through changes.
 */
export function markChanges(root: HTMLElement, hunks: Hunk[]): (HTMLElement | null)[] {
  const blocks = topBlocks(root);
  const tips = new Map<HTMLElement, string[]>();
  const tip = (el: HTMLElement, text: string) => {
    const list = tips.get(el) ?? [];
    list.push(text);
    tips.set(el, list);
  };
  const targets = hunks.map((h) => {
    if (h.kind === "removed") {
      const after = blocks.find((b) => b.start >= h.start);
      const el = after?.el ?? blocks[blocks.length - 1]?.el ?? null;
      if (el) {
        el.dataset.reviewRemoved = after ? "above" : "below";
        tip(el, `Removed:\n${clip(h.before)}`);
      }
      return el;
    }
    const hit = blocks.filter((b) => b.start <= h.end && b.end >= h.start);
    for (const b of hit) {
      if (h.kind === "changed" || b.el.dataset.review !== "changed")
        b.el.dataset.review = h.kind;
      if (h.kind === "changed" && h.before.trim()) tip(b.el, `Before:\n${clip(h.before)}`);
    }
    // A change in frontmatter or between blocks: point at the next block.
    return hit[0]?.el ?? blocks.find((b) => b.start >= h.start)?.el ?? null;
  });
  for (const [el, list] of tips) {
    el.title = list.join("\n\n");
    el.dataset.reviewTitle = "1";
  }
  return targets;
}

// CSS Custom Highlight API (same approach as FindBar).
type HighlightLike = object;
declare const Highlight: { new (...ranges: Range[]): HighlightLike };
type Registry = { set(name: string, h: HighlightLike): void; delete(name: string): void };
const registry = (): Registry | null =>
  (CSS as unknown as { highlights?: Registry }).highlights ?? null;

/** The top-level block a 1-based source line belongs to. */
export function blockForLine(root: HTMLElement, line: number): HTMLElement | null {
  const blocks = topBlocks(root);
  return blocks.find((b) => b.start <= line && b.end >= line)?.el ?? null;
}

/** Mark commented blocks and highlight each comment's quoted passage. */
export function markComments(
  root: HTMLElement,
  comments: (ReviewComment & { at: number })[],
): Map<string, HTMLElement> {
  const anchors = new Map<string, HTMLElement>();
  const ranges: Range[] = [];
  for (const c of comments) {
    if (c.at < 0) continue;
    const el = blockForLine(root, c.at);
    if (!el) continue;
    el.dataset.comment = String(Number(el.dataset.comment ?? 0) + 1);
    anchors.set(c.id, el);
    const r = c.quote ? findText(el, c.quote) : null;
    if (r) ranges.push(r);
  }
  const reg = registry();
  if (reg && typeof Highlight !== "undefined") {
    if (ranges.length) reg.set("review-comment", new Highlight(...ranges));
    else reg.delete("review-comment");
  }
  return anchors;
}

export function clearCommentHighlights() {
  registry()?.delete("review-comment");
}

/** Find `needle` in an element's text (whitespace-insensitive) as a Range. */
function findText(el: HTMLElement, needle: string): Range | null {
  const want = needle.replace(/\s+/g, " ").trim();
  if (!want) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  // Flatten text with a map from each collapsed character to its node offset.
  let flat = "";
  const map: { node: Text; offset: number }[] = [];
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const ch = /\s/.test(t[i]) ? " " : t[i];
      if (ch === " " && lastSpace) continue;
      flat += ch;
      map.push({ node: n, offset: i });
      lastSpace = ch === " ";
    }
  }
  const at = flat.indexOf(want);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + want.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** Source line of the block containing a DOM node inside the preview. */
export function lineForNode(root: HTMLElement, node: Node | null): number | null {
  let el: Node | null = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  if (!(el instanceof HTMLElement) || !el.dataset.sourceLine) return null;
  return Number(el.dataset.sourceLine);
}
