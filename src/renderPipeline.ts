/**
 * The Markdown → HTML transforms shared by the preview and the exporters, so a
 * document exports with the same callouts, highlights, wiki links and math the
 * reader sees. No React or Tauri imports: this module also runs under vitest.
 */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import type { PluggableList } from "unified";
import GithubSlugger from "github-slugger";
import { remarkObsidian } from "./remarkObsidian";
import { extractHeadings } from "./headings";

// Sanitize untrusted HTML embedded in the Markdown. This strips <script>, event
// handlers (onerror/onload/…), javascript: URLs, etc. KaTeX, syntax highlighting
// and heading slugs run AFTER this step, so their generated markup is trusted and
// preserved; only author-supplied raw HTML is filtered.
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "input", // task-list checkboxes
    "details",
    "summary",
    "kbd",
    "mark",
    "section",
    "figure",
    "figcaption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    // className is safe (cannot execute) and is needed so the math/code markers
    // survive to the KaTeX/highlight steps that run after sanitization.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    input: ["type", "checked", "disabled"],
    details: ["open"],
    // Markers produced by remarkObsidian for embeds, tags, and wiki links.
    span: ["dataEmbedTarget", "dataEmbedAnchor", "dataEmbedLabel", "dataTag"],
    a: [...(defaultSchema.attributes?.a ?? []), "dataWikiTarget"],
  },
};

// Callouts: `> [!NOTE]` blockquotes become labelled, coloured admonitions.
// Covers the GitHub five plus Obsidian's aliases, an optional custom title, and
// Obsidian's foldable variants (`[!note]-` collapsed, `[!note]+` expanded).
const ALERT_RE = /^\[!([a-z0-9]+)\]([-+])?[ \t]*([^\r\n]*)(\r?\n)?/i;
const CALLOUT_KINDS = new Set(["note", "tip", "important", "warning", "caution"]);
const CALLOUT_ALIAS: Record<string, string> = {
  abstract: "note",
  summary: "note",
  tldr: "note",
  info: "note",
  quote: "note",
  cite: "note",
  todo: "tip",
  hint: "tip",
  check: "tip",
  done: "tip",
  success: "tip",
  question: "important",
  help: "important",
  faq: "important",
  example: "important",
  attention: "warning",
  fail: "caution",
  failure: "caution",
  missing: "caution",
  danger: "caution",
  error: "caution",
  bug: "caution",
};

export function remarkAlerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (bq: any) => {
    const para = bq.children?.[0];
    if (!para || para.type !== "paragraph" || !Array.isArray(para.children)) return;
    const first = para.children[0];
    if (!first || first.type !== "text") return;
    const m = ALERT_RE.exec(first.value);
    if (!m) return;
    const rawType = m[1].toLowerCase();
    const kind = CALLOUT_KINDS.has(rawType) ? rawType : CALLOUT_ALIAS[rawType];
    if (!kind) return;
    const fold = m[2];
    const customTitle = m[3].trim();
    first.value = first.value.slice(m[0].length);
    if (first.value === "") {
      para.children.shift();
      if (para.children[0]?.type === "break") para.children.shift();
      if (para.children.length === 0) bq.children.shift();
    }
    const foldable = fold === "-" || fold === "+";
    bq.data = {
      ...(bq.data || {}),
      hName: foldable ? "details" : "blockquote",
      hProperties: {
        className: ["markdown-alert", `markdown-alert-${kind}`],
        ...(fold === "+" ? { open: true } : {}),
      },
    };
    const label =
      customTitle || rawType.charAt(0).toUpperCase() + rawType.slice(1);
    bq.children.unshift({
      type: "paragraph",
      data: {
        ...(foldable ? { hName: "summary" } : {}),
        hProperties: { className: ["markdown-alert-title"] },
      },
      children: [{ type: "text", value: label }],
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === "blockquote") apply(child);
      walk(child);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => walk(tree);
}

export function rehypeSourceLines() {
  type Node = { type: string; position?: { start: { line: number } }; properties?: Record<string, unknown>; children?: Node[] };
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (node.type === "element" && node.position) {
        node.properties = { ...node.properties, "data-source-line": node.position.start.line };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** Rehype plugins for the live preview (adds source-line markers last). */
export const previewRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
  rehypeHighlight,
  rehypeSourceLines,
];

/** The remark (Markdown-side) plugins, identical for preview and export. */
export function remarkPluginsFor(resolveWiki?: (target: string) => string | null): PluggableList {
  return [remarkGfm, remarkMath, remarkFrontmatter, remarkAlerts, [remarkObsidian, { resolveWiki }]];
}

/** The section of `source` under the heading matching `anchor` (inclusive). */
export function sliceSection(source: string, anchor: string): string {
  const wanted = new GithubSlugger().slug(anchor);
  const headings = extractHeadings(source);
  const start = headings.find(
    (h) => h.slug === wanted || h.text.toLowerCase() === anchor.toLowerCase(),
  );
  if (!start) return source;
  const lines = source.split("\n");
  const next = headings.find((h) => h.line > start.line && h.depth <= start.depth);
  return lines.slice(start.line, next ? next.line : lines.length).join("\n");
}
