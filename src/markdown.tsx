import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import GithubSlugger from "github-slugger";
import type { PluggableList } from "unified";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Mermaid } from "./Mermaid";
import { remarkObsidian } from "./remarkObsidian";
import {
  basename,
  dirOf,
  isAbsolutePath,
  isLocalMarkdownHref,
  resolveRelativePath,
} from "./paths";
import type { Heading } from "./headings";
import { extractHeadings } from "./headings";
import "katex/dist/katex.min.css";

export type { Heading };
export { extractHeadings };

// Sanitize untrusted HTML embedded in the Markdown. This strips <script>, event
// handlers (onerror/onload/…), javascript: URLs, etc. KaTeX, syntax highlighting
// and heading slugs run AFTER this step, so their generated markup is trusted and
// preserved; only author-supplied raw HTML is filtered.
const sanitizeSchema = {
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

function remarkAlerts() {
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

const rehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
  rehypeHighlight,
];

const SAFE_LINK = /^(https?:|mailto:)/i;
const REMOTE_SRC = /^(https?:|data:|blob:|asset:)/i;

export function resolveImageSrc(src: string, basePath?: string, blockRemote?: boolean): string {
  if (!src) return src;
  if (blockRemote && /^https?:/i.test(src)) return "";
  if (REMOTE_SRC.test(src)) return src;
  const isAbsolute = src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src);
  let filePath = src.replace(/^file:\/\//, "");
  if (!isAbsolute && basePath) {
    filePath = basePath.replace(/[\\/]+$/, "") + "/" + src;
  }
  try {
    return convertFileSrc(filePath);
  } catch {
    return src;
  }
}

type PreviewProps = {
  source: string;
  dark: boolean;
  onToggleTask: (index: number) => void;
  /** Open a resolved local Markdown path (relative links). */
  onOpenLocal?: (path: string) => void;
  basePath?: string;
  blockRemoteImages?: boolean;
  /** Resolve `[[wiki links]]` against the open folder's index. */
  resolveWiki?: (target: string) => string | null;
  /** Called when a `#tag` chip is clicked. */
  onTagClick?: (tag: string) => void;
  /** Nesting level: 0 = top-level document, >0 = embed/hover content. */
  depth?: number;
};

const MAX_EMBED_DEPTH = 3;
const noopTask = () => {};

/** The section of `source` under the heading matching `anchor` (inclusive). */
function sliceSection(source: string, anchor: string): string {
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

/** A note transcluded into the preview via `![[target]]`. */
function EmbedNote({
  path,
  anchor,
  label,
  depth,
  dark,
  basePassthrough,
}: {
  path: string;
  anchor: string;
  label: string;
  depth: number;
  dark: boolean;
  basePassthrough: Pick<
    PreviewProps,
    "onOpenLocal" | "blockRemoteImages" | "resolveWiki" | "onTagClick"
  >;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const tooDeep = depth + 1 >= MAX_EMBED_DEPTH;

  useEffect(() => {
    if (tooDeep) return;
    let live = true;
    setText(null);
    setFailed(false);
    invoke<string>("read_file", { path })
      .then((t) => {
        if (live) setText(t);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [path, tooDeep]);

  const section = useMemo(
    () => (text !== null && anchor ? sliceSection(text, anchor) : text),
    [text, anchor],
  );

  const title = (label || basename(path)) + (anchor ? ` › ${anchor}` : "");
  return (
    <span className="embed-note">
      <span className="embed-note-head">
        <button
          className="embed-note-open"
          onClick={() => basePassthrough.onOpenLocal?.(path)}
          title={path}
        >
          {title}
        </button>
      </span>
      {tooDeep ? null : failed ? (
        <span className="embed-note-missing">This file could not be read.</span>
      ) : section === null ? (
        <span className="embed-note-missing">Loading…</span>
      ) : (
        <span className="embed-note-body">
          <Preview
            source={section}
            dark={dark}
            basePath={dirOf(path)}
            onToggleTask={noopTask}
            depth={depth + 1}
            {...basePassthrough}
          />
        </span>
      )}
    </span>
  );
}

/** The small rendered card shown when hovering an internal link. */
function HoverCard({
  path,
  x,
  y,
  dark,
  passthrough,
  onOpen,
  onMouseEnter,
  onMouseLeave,
}: {
  path: string;
  x: number;
  y: number;
  dark: boolean;
  passthrough: Pick<PreviewProps, "blockRemoteImages" | "resolveWiki">;
  onOpen: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    invoke<string>("read_file", { path })
      .then((t) => {
        if (live) setText(t.length > 4000 ? t.slice(0, 4000) + "\n\n…" : t);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [path]);

  const width = 380;
  const height = 340;
  const left = Math.max(8, Math.min(x - 40, window.innerWidth - width - 16));
  const top = y + height + 40 > window.innerHeight ? Math.max(8, y - height - 12) : y + 18;

  return (
    <div
      className="hover-pop"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button className="hover-pop-title" onClick={onOpen} title={path}>
        {basename(path)}
      </button>
      <div className="hover-pop-body markdown-body">
        {failed ? (
          <p className="embed-note-missing">This file could not be read.</p>
        ) : text === null ? (
          <p className="embed-note-missing">Loading…</p>
        ) : (
          <Preview
            source={text}
            dark={dark}
            basePath={dirOf(path)}
            onToggleTask={noopTask}
            depth={MAX_EMBED_DEPTH - 1}
            {...passthrough}
          />
        )}
      </div>
    </div>
  );
}

function PreviewInner({
  source,
  dark,
  onToggleTask,
  onOpenLocal,
  basePath,
  blockRemoteImages,
  resolveWiki,
  onTagClick,
  depth = 0,
}: PreviewProps) {
  // Task checkboxes render in document order; track their index to map back to source.
  // Must reset every render (not be memoized across renders).
  let taskIndex = -1;

  const [hover, setHover] = useState<{ path: string; x: number; y: number } | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const beginHover = (path: string, x: number, y: number) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setHover({ path, x, y }), 380);
  };
  const endHover = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 250);
  };
  const keepHover = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  };

  const remarkPlugins = useMemo<PluggableList>(
    () => [
      remarkGfm,
      remarkMath,
      remarkFrontmatter,
      remarkAlerts,
      [remarkObsidian, { resolveWiki }],
    ],
    [resolveWiki],
  );

  /** Absolute local file behind a preview link, or null for web/anchor links. */
  const localTargetOf = (url: string): string | null => {
    if (!url || url.startsWith("#") || SAFE_LINK.test(url)) return null;
    if (!isLocalMarkdownHref(url)) return null;
    if (isAbsolutePath(url)) return url.split(/[#?]/)[0];
    return basePath ? resolveRelativePath(basePath, url) : null;
  };

  const components: Components = {
    code({ node: _node, className, children, ...rest }) {
      if (className === "language-mermaid") {
        return <Mermaid code={String(children).replace(/\n$/, "")} dark={dark} />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    img({ node: _node, src, alt, ...rest }) {
      return (
        <img
          src={resolveImageSrc(typeof src === "string" ? src : "", basePath, blockRemoteImages)}
          alt={alt}
          {...rest}
        />
      );
    },
    input({ node: _node, ...props }) {
      if (props.type === "checkbox") {
        taskIndex += 1;
        const idx = taskIndex;
        return (
          <input type="checkbox" checked={!!props.checked} onChange={() => onToggleTask(idx)} />
        );
      }
      return <input {...props} />;
    },
    span({ node: _node, className, children, ...rest }) {
      const cls = String(className ?? "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrs = rest as any;
      if (cls.includes("md-tag")) {
        const tag = String(attrs["data-tag"] ?? "");
        return (
          <span
            className={cls}
            role="button"
            tabIndex={0}
            onClick={() => tag && onTagClick?.(tag)}
          >
            {children}
          </span>
        );
      }
      if (cls.includes("wiki-embed")) {
        const target = String(attrs["data-embed-target"] ?? "");
        if (target) {
          return (
            <EmbedNote
              path={target}
              anchor={String(attrs["data-embed-anchor"] ?? "")}
              label={String(attrs["data-embed-label"] ?? "")}
              depth={depth}
              dark={dark}
              basePassthrough={{ onOpenLocal, blockRemoteImages, resolveWiki, onTagClick }}
            />
          );
        }
      }
      return (
        <span className={className} {...rest}>
          {children}
        </span>
      );
    },
    a({ node: _node, href, children, ...rest }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wikiTarget = (rest as any)["data-wiki-target"] as string | undefined;
      const url = wikiTarget || (href ?? "");
      const local = localTargetOf(url);
      return (
        <a
          href={url}
          onClick={(e) => {
            e.preventDefault();
            if (url.startsWith("#")) {
              document
                .getElementById(url.slice(1))
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            } else if (SAFE_LINK.test(url)) {
              openUrl(url).catch(() => {});
            } else if (local && onOpenLocal) {
              onOpenLocal(local);
            }
          }}
          onMouseEnter={
            depth === 0 && local
              ? (e) => beginHover(local, e.clientX, e.clientY)
              : undefined
          }
          onMouseLeave={depth === 0 && local ? endHover : undefined}
          {...rest}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {source}
      </ReactMarkdown>
      {hover && depth === 0 && (
        <HoverCard
          path={hover.path}
          x={hover.x}
          y={hover.y}
          dark={dark}
          passthrough={{ blockRemoteImages, resolveWiki }}
          onOpen={() => {
            setHover(null);
            onOpenLocal?.(hover.path);
          }}
          onMouseEnter={keepHover}
          onMouseLeave={endHover}
        />
      )}
    </>
  );
}

export const Preview = memo(PreviewInner);
