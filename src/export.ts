import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import remarkDocx from "remark-docx";
import { imagePlugin } from "remark-docx/plugins/image";
import { latexPlugin } from "remark-docx/plugins/latex";
import type { RemarkDocxPlugin } from "remark-docx";
import { TextRun } from "docx";
import { remarkPluginsFor, sanitizeSchema, sliceSection } from "./renderPipeline";
import { basename, dirOf, isAbsolutePath, resolveRelativePath } from "./paths";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Everything an export needs from the outside world. All of it is optional:
 * without a reader, embeds fall back to their label and local images keep
 * their original reference. The app wires these to Tauri commands; tests
 * pass in-memory fakes.
 */
export type ExportContext = {
  /** Folder of the document being exported (relative images, embeds). */
  baseDir?: string;
  /** Resolve `[[wiki links]]` / `![[embeds]]` against the open folder. */
  resolveWiki?: (target: string) => string | null;
  /** Read a text file (embedded notes). */
  readText?: (path: string) => Promise<string>;
  /** Read a binary file as base64 (local images). */
  readBase64?: (path: string) => Promise<string>;
  /** Render Mermaid source to an SVG string. */
  renderMermaid?: (code: string, opts: { htmlLabels: boolean }) => Promise<string>;
};

const MAX_EMBED_DEPTH = 3;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};

const NON_LOCAL_SRC = /^(https?:|data:|blob:|asset:|mailto:|#)/i;

/**
 * The absolute file behind an image reference, or null when it isn't a local
 * file (web URL, data URI, …) or can't be resolved without a base folder.
 * Handles `file://` URLs, percent-encoding (`my%20pic.png`), and query/hash
 * suffixes, matching how the preview resolves the same reference.
 */
export function localImagePath(src: string, baseDir?: string): string | null {
  if (!src || NON_LOCAL_SRC.test(src)) return null;
  let p = src.replace(/^file:\/\//i, "").split(/[?#]/)[0];
  try {
    p = decodeURI(p);
  } catch {
    /* keep the raw reference */
  }
  // file:///C:/x → /C:/x → C:/x
  p = p.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
  if (!p) return null;
  if (isAbsolutePath(p)) return p;
  return baseDir ? resolveRelativePath(baseDir, p) : null;
}

/** MIME type for an image path, from its extension. */
export function imageMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// mdast stage: the same remark transforms as the preview, then the parts the
// preview does interactively (embeds, Mermaid) are resolved up front.
// ---------------------------------------------------------------------------

function parseTree(source: string, ctx: ExportContext): any {
  const processor = unified().use(remarkParse).use(remarkPluginsFor(ctx.resolveWiki));
  return processor.runSync(processor.parse(source));
}

const hasClass = (node: any, cls: string): boolean => {
  const c = node?.data?.hProperties?.className;
  return Array.isArray(c) && c.includes(cls);
};

/** Point relative image references at absolute paths (embedded notes live elsewhere). */
function absolutizeImages(node: any, baseDir?: string) {
  if (node.type === "image") {
    const abs = localImagePath(node.url, baseDir);
    if (abs) node.url = abs;
  }
  node.children?.forEach((c: any) => absolutizeImages(c, baseDir));
}

async function embedReplacement(node: any, ctx: ExportContext, depth: number): Promise<any[]> {
  const props = node.data?.hProperties ?? {};
  const target = String(props.dataEmbedTarget ?? "");
  const anchor = String(props.dataEmbedAnchor ?? "");
  const label = String(props.dataEmbedLabel ?? "") || basename(target);
  const title = label + (anchor ? ` › ${anchor}` : "");
  const fallback = { type: "strong", children: [{ type: "text", value: title }] };
  if (!target || !ctx.readText || depth + 1 >= MAX_EMBED_DEPTH) return [fallback];
  let text: string;
  try {
    text = await ctx.readText(target);
  } catch {
    return [fallback];
  }
  const section = anchor ? sliceSection(text, anchor) : text;
  const embedDir = dirOf(target);
  const tree = parseTree(section, { ...ctx, baseDir: embedDir });
  await prepareTree(tree, { ...ctx, baseDir: embedDir }, depth + 1);
  absolutizeImages(tree, embedDir);
  return [
    {
      type: "blockquote",
      data: { hName: "div", hProperties: { className: ["embed-note"] } },
      children: [
        {
          type: "paragraph",
          data: { hProperties: { className: ["embed-note-head"] } },
          children: [{ type: "strong", children: [{ type: "text", value: title }] }],
        },
        ...tree.children,
      ],
    },
  ];
}

/**
 * Make the tree static: drop frontmatter, inline `![[embeds]]`, and turn wiki
 * links into plain styled text (their targets are absolute paths on this
 * machine — meaningless, and a privacy leak, in a file sent to someone else).
 */
async function prepareTree(tree: any, ctx: ExportContext, depth = 0): Promise<void> {
  const walk = async (parent: any) => {
    if (!Array.isArray(parent.children)) return;
    const out: any[] = [];
    for (const child of parent.children) {
      if (child.type === "yaml" || child.type === "toml") continue;
      if (
        child.type === "paragraph" &&
        child.children?.length === 1 &&
        child.children[0].type === "wikiEmbed"
      ) {
        // A block-level embed: splice the note's content in place of the paragraph.
        const repl = await embedReplacement(child.children[0], ctx, depth);
        out.push(...(repl[0].type === "strong" ? [{ type: "paragraph", children: repl }] : repl));
        continue;
      }
      if (child.type === "wikiEmbed") {
        // Inline amid other text: there's no room for a whole note, keep its title.
        out.push({ type: "strong", children: [{ type: "text", value: String(child.data?.hProperties?.dataEmbedLabel ?? "") }] });
        continue;
      }
      if (child.type === "link" && hasClass(child, "wiki-link") && !String(child.url).startsWith("#")) {
        out.push({
          type: "wikiLinkText",
          data: { hName: "span", hProperties: { className: ["wiki-link"] } },
          children: child.children,
        });
        continue;
      }
      await walk(child);
      out.push(child);
    }
    parent.children = out;
  };
  await walk(tree);
}

/** Every Mermaid code block, in document order. */
function mermaidNodes(tree: any): any[] {
  const found: any[] = [];
  const walk = (n: any) => {
    if (n.type === "code" && n.lang === "mermaid") found.push(n);
    n.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

/** Every image reference, in document order. */
function imageNodes(tree: any): any[] {
  const found: any[] = [];
  const walk = (n: any) => {
    if (n.type === "image") found.push(n);
    n.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

/**
 * Local images the document references that don't exist on disk, as the
 * references are written (deduplicated). `exists` is the path check — the app
 * passes the `path_exists` command.
 */
export async function findMissingImages(
  source: string,
  ctx: ExportContext,
  exists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const tree = parseTree(source, ctx);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const img of imageNodes(tree)) {
    const path = localImagePath(img.url, ctx.baseDir);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (!(await exists(path).catch(() => false))) missing.push(img.url);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/**
 * Generated content that must survive sanitization is attached after it, via
 * "slot" classes: rehype-sanitize keeps className but strips data: image
 * sources and anything SVG. Slots are filled by `rehypeFillSlots`, which runs
 * after sanitize alongside KaTeX and highlighting (the preview's trust model:
 * only author-supplied HTML is filtered, our own output is trusted).
 */
type Slots = { images: Map<string, string>; mermaid: Map<string, string> };

function rehypeFillSlots(slots: Slots) {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "element") {
        const cls: string[] = Array.isArray(node.properties?.className)
          ? node.properties.className.map(String)
          : [];
        const imgSlot = cls.find((c) => c.startsWith("export-img-"));
        if (imgSlot && node.tagName === "img") {
          const src = slots.images.get(imgSlot);
          if (src) node.properties.src = src;
          node.properties.className = cls.filter((c) => c !== imgSlot);
        }
        const mmSlot = cls.find((c) => c.startsWith("export-mermaid-"));
        if (mmSlot) {
          const svg = slots.mermaid.get(mmSlot);
          node.properties.className = ["mermaid-diagram"];
          if (svg) node.children = [{ type: "raw", value: svg }];
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Render Markdown to an HTML fragment that matches the preview: callouts,
 * highlights, tags, embeds, math, diagrams, highlighted code. Local images are
 * inlined as data URIs, so the fragment stands alone.
 *
 * Math uses KaTeX's MathML output: every current browser renders MathML
 * natively, so the file needs neither KaTeX's stylesheet nor its ~20 web
 * fonts to display offline.
 */
export async function markdownToHtml(md: string, ctx: ExportContext = {}): Promise<string> {
  const tree = parseTree(md, ctx);
  await prepareTree(tree, ctx);

  const slots: Slots = { images: new Map(), mermaid: new Map() };

  if (ctx.renderMermaid) {
    let i = 0;
    for (const node of mermaidNodes(tree)) {
      try {
        const svg = await ctx.renderMermaid(node.value, { htmlLabels: true });
        const key = `export-mermaid-${i++}`;
        slots.mermaid.set(key, svg);
        Object.assign(node, {
          type: "mermaidDiagram",
          data: { hName: "div", hProperties: { className: [key] } },
          children: [],
        });
      } catch {
        /* leave the source visible as a code block */
      }
    }
  }

  if (ctx.readBase64) {
    let i = 0;
    for (const img of imageNodes(tree)) {
      const path = localImagePath(img.url, ctx.baseDir);
      if (!path) continue;
      try {
        const b64 = await ctx.readBase64(path);
        const key = `export-img-${i++}`;
        slots.images.set(key, `data:${imageMime(path)};base64,${b64}`);
        img.data = { ...(img.data || {}), hProperties: { className: [key] } };
      } catch {
        /* missing image: keep the reference */
      }
    }
  }

  const hast = await unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeKatex, { output: "mathml" })
    .use(rehypeSlug)
    .use(rehypeHighlight)
    .use(rehypeFillSlots, slots)
    .run(tree);
  return unified().use(rehypeStringify, { allowDangerousHtml: true }).stringify(hast as any);
}

/** Parse Markdown to its mdast syntax tree — used for the JSON export. */
export function markdownToAst(md: string): unknown {
  return unified().use(remarkParse).use(remarkGfm).parse(md);
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

const CALLOUT_COLOR: Record<string, string> = {
  note: "0969DA",
  tip: "1A7F37",
  important: "8250DF",
  warning: "9A6700",
  caution: "CF222E",
};

/** Callout titles become a bold, coloured label run (see `docxExtras`). */
function markCalloutTitles(tree: any) {
  const walk = (n: any) => {
    if (n.type === "blockquote" && hasClass(n, "markdown-alert")) {
      const kindCls: string | undefined = n.data.hProperties.className.find(
        (c: string) => c.startsWith("markdown-alert-"),
      );
      const kind = kindCls?.slice("markdown-alert-".length) ?? "note";
      const title = n.children?.[0];
      if (title && hasClass(title, "markdown-alert-title")) {
        const text = title.children.map((c: any) => c.value ?? "").join("");
        title.children = [{ type: "calloutLabel", value: text, kind }];
      }
    }
    n.children?.forEach(walk);
  };
  walk(tree);
}

/** Builders for the node types the preview's remark plugins add. */
const docxExtras: RemarkDocxPlugin = async () =>
  ({
    wikiHighlight: (node: any, ctx: any) =>
      node.children.map(
        (c: any) =>
          new TextRun({
            text: c.value ?? "",
            bold: ctx.style.bold,
            italics: ctx.style.italic,
            strike: ctx.style.strike,
            highlight: "yellow",
          }),
      ),
    wikiTag: (node: any, ctx: any) => ctx.render(node.children, ctx),
    wikiLinkText: (node: any, ctx: any) => ctx.render(node.children, ctx),
    calloutLabel: (node: any) =>
      new TextRun({ text: node.value, bold: true, color: CALLOUT_COLOR[node.kind] ?? CALLOUT_COLOR.note }),
  }) as any;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function utf8ToBase64(s: string): string {
  return arrayBufferToBase64(new TextEncoder().encode(s).buffer as ArrayBuffer);
}

/** Render Markdown to a .docx file, returned as a base64 string for binary writing. */
export async function markdownToDocxBase64(md: string, ctx: ExportContext = {}): Promise<string> {
  const tree = parseTree(md, ctx);
  await prepareTree(tree, ctx);
  markCalloutTitles(tree);
  absolutizeImages(tree, ctx.baseDir);

  if (ctx.renderMermaid) {
    for (const node of mermaidNodes(tree)) {
      try {
        // SVG labels, not HTML in <foreignObject>: the image plugin rasterizes
        // SVG to PNG through a canvas for Word, and foreignObject taints it.
        const svg = await ctx.renderMermaid(node.value, { htmlLabels: false });
        Object.assign(node, {
          type: "paragraph",
          children: [
            { type: "image", url: `data:image/svg+xml;base64,${utf8ToBase64(svg)}`, alt: "diagram" },
          ],
        });
        delete node.lang;
        delete node.value;
      } catch {
        /* keep the diagram source as a code block */
      }
    }
  }

  const load = async (url: string): Promise<ArrayBuffer> => {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const meta = url.slice(0, comma);
      const body = url.slice(comma + 1);
      return meta.endsWith(";base64")
        ? base64ToArrayBuffer(body)
        : (new TextEncoder().encode(decodeURIComponent(body)).buffer as ArrayBuffer);
    }
    const path = localImagePath(url, ctx.baseDir);
    if (path) {
      if (!ctx.readBase64) throw new Error(`Cannot read ${url}`);
      return base64ToArrayBuffer(await ctx.readBase64(path));
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  };

  const processor = unified().use(remarkDocx, {
    plugins: [docxExtras, imagePlugin({ load }), latexPlugin()],
  });
  const transformed = await processor.run(tree);
  const result = (processor.stringify(transformed as any) as unknown) as
    | ArrayBuffer
    | Blob
    | Promise<ArrayBuffer | Blob>;
  const resolved = await result;
  const buffer = resolved instanceof Blob ? await resolved.arrayBuffer() : resolved;
  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Standalone HTML document
// ---------------------------------------------------------------------------

/** The reading stylesheet, a static copy of the preview's (light + dark). */
const EXPORT_CSS = `
:root {
  --bg: #ffffff; --text: #1f2328; --muted: #59636e; --hairline: #d1d9e0;
  --accent: #0969da; --code-bg: rgba(0,0,0,.05); --mark: rgba(255,213,0,.35);
  --hl-comment: #6e7781; --hl-keyword: #cf222e; --hl-entity: #8250df;
  --hl-string: #0a3069; --hl-constant: #0550ae; --hl-tag: #116329;
  --note: #0969da; --tip: #1a7f37; --important: #8250df; --warning: #9a6700; --caution: #cf222e;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161b; --text: #f5f5f7; --muted: rgba(235,235,245,.68); --hairline: rgba(255,255,255,.14);
    --accent: #4493f8; --code-bg: rgba(255,255,255,.07); --mark: rgba(255,213,0,.28);
    --hl-comment: #8b949e; --hl-keyword: #ff7b72; --hl-entity: #d2a8ff;
    --hl-string: #a5d6ff; --hl-constant: #79c0ff; --hl-tag: #7ee787;
    --note: #4493f8; --tip: #3fb950; --important: #ab7df8; --warning: #d29922; --caution: #f85149;
  }
  /* Diagrams are drawn with Mermaid's light theme; give them a light card. */
  .mermaid-diagram { background: #fff; border-radius: 8px; padding: 12px; }
}
body { background: var(--bg); color: var(--text); margin: 0; }
.markdown-body { max-width: 760px; margin: 0 auto; padding: 44px 32px 96px;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.markdown-body > :first-child { margin-top: 0; }
h1, h2, h3 { margin-top: 1.5em; line-height: 1.25; font-weight: 600; }
h1, h2 { letter-spacing: -0.02em; }
code { background: var(--code-bg); padding: .2em .4em; border-radius: 6px; font-size: 85%;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
pre { background: var(--code-bg); padding: 16px; border-radius: 10px; border: 1px solid var(--hairline); overflow: auto; }
pre code { background: none; padding: 0; font-size: 100%; }
blockquote { color: var(--muted); border-left: .25em solid var(--hairline); margin: 0; padding: 0 1em; }
table { border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; }
th, td { border: 1px solid var(--hairline); padding: 6px 13px; }
th { background: var(--code-bg); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid var(--hairline); margin: 1.6em 0; }
input[type="checkbox"] { margin-right: .4em; }
mark { background: var(--mark); color: inherit; border-radius: 3px; padding: 0 2px; }
.wiki-link { border-bottom: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); }
.md-tag { display: inline-block; font-size: .82em; line-height: 1.4; padding: 0 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.markdown-alert { border-left: .25em solid var(--alert); background: color-mix(in srgb, var(--alert) 9%, transparent);
  border-radius: 0 8px 8px 0; padding: .5em 1em; margin: 1em 0; color: var(--text); }
.markdown-alert > :first-child { margin-top: 0; }
.markdown-alert > :last-child { margin-bottom: 0; }
.markdown-alert-title { font-weight: 600; color: var(--alert); margin-bottom: .3em; }
details.markdown-alert > summary { cursor: pointer; }
.markdown-alert-note { --alert: var(--note); }
.markdown-alert-tip { --alert: var(--tip); }
.markdown-alert-important { --alert: var(--important); }
.markdown-alert-warning { --alert: var(--warning); }
.markdown-alert-caution { --alert: var(--caution); }
.embed-note { border: 1px solid var(--hairline); border-left-width: 1px; border-radius: 8px; padding: 2px 14px; margin: .6em 0; color: var(--text); }
.embed-note-head { font-size: .82em; color: var(--muted); border-bottom: 1px solid var(--hairline); margin: 0 -14px .5em; padding: 6px 14px; }
.mermaid-diagram { margin: 1em 0; text-align: center; }
.mermaid-diagram svg { max-width: 100%; height: auto; }
math[display="block"] { margin: 1em 0; overflow-x: auto; }
.hljs-comment, .hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag { color: var(--hl-keyword); }
.hljs-string, .hljs-regexp, .hljs-addition { color: var(--hl-string); }
.hljs-number, .hljs-built_in, .hljs-symbol, .hljs-meta, .hljs-attr, .hljs-attribute,
.hljs-variable, .hljs-template-variable, .hljs-type { color: var(--hl-constant); }
.hljs-title, .hljs-section, .hljs-name { color: var(--hl-entity); }
.hljs-tag { color: var(--hl-tag); }
@media print {
  .markdown-body { padding: 0; max-width: none; }
  pre, blockquote, table, .mermaid-diagram, img { break-inside: avoid; }
}
`;

/** Wrap an HTML fragment in a self-contained, styled document for export. */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let mermaidCounter = 0;

/**
 * Render a diagram with the light theme for export. Mermaid's config is
 * global; the preview re-initializes with its own theme before every render,
 * so this doesn't leak into the reading view.
 */
export async function renderMermaidSvg(
  code: string,
  { htmlLabels }: { htmlLabels: boolean },
): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    htmlLabels,
    flowchart: { htmlLabels },
  });
  const { svg } = await mermaid.render(`export-mermaid-${mermaidCounter++}`, code);
  return svg;
}
