/**
 * Incremental preview rendering. The source is cut into top-level blocks that
 * render independently, so an edit re-parses only the block it touches instead
 * of the whole document. Everything that crosses block boundaries is settled
 * here: heading slugs are assigned document-wide, and source lines are stored
 * block-relative (data-rel-line) and made absolute in the DOM by
 * applyBlockLines, so inserting a line doesn't re-render every block below it.
 *
 * No React or Tauri imports: this module also runs under vitest.
 */
import { unified, type PluggableList, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { defaultUrlTransform } from "react-markdown";
import { urlAttributes } from "html-url-attributes";
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { rehypeSourceLines, remarkPluginsFor, sanitizeSchema } from "./renderPipeline";

export type SourceBlock = {
  text: string;
  /** 0-based index of the block's first line in the source. */
  line: number;
};

/** Link reference and footnote definitions resolve document-wide. */
const DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:/m;
const BLANK_RE = /^\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const LIST_RE = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const HR_DASHES_RE = /^---\s*$/;
const HTML_TAG_RE =
  /<(\/?)(details|div|section|figure|table|blockquote|ul|ol|dl|aside|article|center|pre|form|fieldset|nav|header|footer|main|p)\b[^>]*?(\/?)>/gi;
const INLINE_CODE_RE = /(`+)[^`]*?\1/g;

/**
 * Cut `source` into blocks that render the same apart as together. A cut only
 * happens after a blank line, before an unindented line, outside fences, maths,
 * HTML containers and comments, and never between the items of one list. When
 * in doubt it merges, which is always safe; documents with reference or
 * footnote definitions stay whole.
 */
export function splitBlocks(source: string): SourceBlock[] {
  if (DEFINITION_RE.test(source)) return [{ text: source, line: 0 }];
  const lines = source.split("\n");
  const blocks: SourceBlock[] = [];
  let start = 0;
  let last = -1; // last non-blank line of the current block
  let blockIsList = false;
  let sawBlank = false;
  let frontmatter = false;
  let fence: { char: string; len: number } | null = null;
  let math = false;
  let comment = false;
  let htmlDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BLANK_RE.test(line)) {
      if (!frontmatter && !fence && !math && !comment && htmlDepth === 0) sawBlank = true;
      continue;
    }
    if (
      sawBlank &&
      last >= start &&
      !/^\s/.test(line) &&
      // A block starting with `---` would parse as frontmatter.
      !HR_DASHES_RE.test(line) &&
      !(blockIsList && LIST_RE.test(line))
    ) {
      blocks.push({ text: lines.slice(start, last + 1).join("\n"), line: start });
      start = i;
    }
    if (last < start) blockIsList = LIST_RE.test(line);
    sawBlank = false;
    last = i;

    if (i === 0 && HR_DASHES_RE.test(line)) {
      frontmatter = true;
    } else if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
    } else if (comment) {
      if (line.includes("-->")) comment = false;
    } else if (fence) {
      const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
    } else if (math) {
      if (line.trimStart().startsWith("$$")) math = false;
    } else {
      const f = FENCE_RE.exec(line);
      const trimmed = line.trim();
      if (f) {
        fence = { char: f[1][0], len: f[1].length };
      } else if (trimmed.startsWith("$$")) {
        // `$$x$$` on one line is complete; a bare `$$` opens a block.
        if (trimmed.length < 4 || !trimmed.endsWith("$$")) math = true;
      } else {
        const code = line.replace(INLINE_CODE_RE, "");
        const open = code.lastIndexOf("<!--");
        if (open >= 0 && code.indexOf("-->", open) < 0) comment = true;
        for (const m of code.matchAll(HTML_TAG_RE)) {
          if (m[1]) htmlDepth = Math.max(0, htmlDepth - 1);
          else if (!m[3]) htmlDepth++;
        }
      }
    }
  }
  if (last >= start) blocks.push({ text: lines.slice(start, last + 1).join("\n"), line: start });
  return blocks;
}

/** Rehype plugins for one preview block: slugs and absolute lines come later. */
export const blockRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeHighlight,
  [rehypeSourceLines, { attribute: "data-rel-line" }],
];

export type BlockProcessor = Processor<any, any, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const processors = new WeakMap<object, BlockProcessor>();
let plainProcessor: BlockProcessor | null = null;

/**
 * One processor per wiki resolver, shared by every preview, so blocks parsed
 * for one view (the reader, Split view, an embed) are reused by the others.
 */
export function blockProcessorFor(resolveWiki?: (target: string) => string | null): BlockProcessor {
  if (!resolveWiki) return (plainProcessor ??= createBlockProcessor(remarkPluginsFor()));
  let processor = processors.get(resolveWiki);
  if (!processor) {
    processor = createBlockProcessor(remarkPluginsFor(resolveWiki));
    processors.set(resolveWiki, processor);
  }
  return processor;
}

export function createBlockProcessor(remarkPlugins: PluggableList): BlockProcessor {
  return unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(blockRehypePlugins) as unknown as BlockProcessor;
}

export type PreparedBlock = {
  hast: Root;
  /** Headings that still need an id (author-supplied ids are kept). */
  headings: Element[];
  /** Their text, as rehype-slug would slug it. */
  headingTexts: string[];
};

function textOf(node: Element | ElementContent): string {
  if ("children" in node) return node.children.map(textOf).join("");
  return "value" in node ? node.value : "";
}

/**
 * Parse one block to hast, applying react-markdown's own post-processing: raw
 * HTML that survived becomes text, URLs go through its safe-URL transform.
 */
export function prepareBlock(processor: BlockProcessor, text: string): PreparedBlock {
  const hast = processor.runSync(processor.parse(text)) as Root;
  const headings: Element[] = [];
  const walk = (parent: Root | Element) => {
    parent.children.forEach((child, i) => {
      if (child.type === "raw") {
        parent.children[i] = { type: "text", value: child.value };
        return;
      }
      if (child.type !== "element") return;
      for (const key in urlAttributes) {
        const test = urlAttributes[key];
        if (Object.prototype.hasOwnProperty.call(child.properties, key) && (test === null || test.includes(child.tagName))) {
          child.properties[key] = defaultUrlTransform(String(child.properties[key] || ""));
        }
      }
      if (/^h[1-6]$/.test(child.tagName) && !child.properties.id) headings.push(child);
      walk(child);
    });
  };
  walk(hast);
  return { hast, headings, headingTexts: headings.map(textOf) };
}

/** Parsed blocks are reused across previews, least recently used first out. */
const CACHE_CHARS = 400_000;
type ParsedCache = { blocks: Map<string, PreparedBlock>; chars: number };
const parsed = new WeakMap<BlockProcessor, ParsedCache>();

export function cachedBlock(processor: BlockProcessor, text: string): PreparedBlock {
  let cache = parsed.get(processor);
  if (!cache) parsed.set(processor, (cache = { blocks: new Map(), chars: 0 }));
  let block = cache.blocks.get(text);
  if (block) {
    cache.blocks.delete(text);
  } else {
    block = prepareBlock(processor, text);
    cache.chars += text.length;
    for (const old of cache.blocks.keys()) {
      if (cache.chars <= CACHE_CHARS) break;
      cache.blocks.delete(old);
      cache.chars -= old.length;
    }
  }
  cache.blocks.set(text, block);
  return block;
}

/**
 * Point a block's hast at one rendering of it: its heading ids and the block
 * id on its top-level elements. A parsed block can be shared (identical blocks,
 * several previews), so call this right before converting it.
 */
export function stampBlock(block: PreparedBlock, ids: string[], blockId: string) {
  block.headings.forEach((h, i) => {
    h.properties.id = ids[i];
  });
  for (const child of block.hast.children) {
    if (child.type === "element") child.properties["data-blk"] = blockId;
  }
}

/** Heading ids for every block, deduplicated across the whole document. */
export function assignSlugs(blocks: Pick<PreparedBlock, "headingTexts">[]): string[][] {
  const slugger = new GithubSlugger();
  return blocks.map((b) => b.headingTexts.map((t) => slugger.slug(t)));
}

/** Hast for the whole document from its blocks, with absolute lines (tests). */
export function joinBlocks(blocks: PreparedBlock[], starts: number[]): Root {
  const children: RootContent[] = [];
  blocks.forEach((b, i) => {
    const shift = (node: RootContent) => {
      if (node.type !== "element") return;
      const { "data-blk": _blk, "data-rel-line": rel, ...rest } = node.properties;
      node.properties = rel === undefined ? rest : { ...rest, "data-source-line": Number(rel) + starts[i] };
      node.children.forEach(shift);
    };
    const copy = structuredClone(b.hast);
    copy.children.forEach(shift);
    children.push(...copy.children);
  });
  return { type: "root", children };
}

/**
 * The elements of a rendered block that carry a source line: its top-level
 * elements and their descendants. Nested previews (embeds) carry their own
 * block ids and are left to themselves.
 */
export function lineNodesOf(tops: Iterable<HTMLElement>): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const top of tops) {
    if (top.dataset.relLine) out.push(top);
    top.querySelectorAll<HTMLElement>("[data-rel-line]").forEach((el) => {
      if (el.closest("[data-blk]") === top) out.push(el);
    });
  }
  return out;
}

/** Write absolute `data-source-line`s for a block that starts at `offset`. */
export function applyBlockLines(nodes: HTMLElement[], offset: number) {
  for (const el of nodes) {
    el.dataset.sourceLine = String(Number(el.dataset.relLine) + offset);
  }
}
