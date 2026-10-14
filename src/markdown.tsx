import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Mermaid } from "./Mermaid";
import { previewRehypePlugins, remarkPluginsFor, sliceSection } from "./renderPipeline";
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
  /** Toggle the task on this 1-based source line. */
  onToggleTask: (line: number) => void;
  /** Open a resolved local path, with any `#fragment` (relative links). */
  onOpenLocal?: (path: string) => void;
  /** Called before an in-document anchor jump, so it can be undone with Back. */
  onBeforeNavigate?: () => void;
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
  onBeforeNavigate,
  basePath,
  blockRemoteImages,
  resolveWiki,
  onTagClick,
  depth = 0,
}: PreviewProps) {
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
    () => remarkPluginsFor(resolveWiki),
    [resolveWiki],
  );

  /** Absolute local file behind a preview link, or null for web/anchor links. */
  /** Any local file a link points at (without its fragment), or null. */
  const localFileOf = (url: string): string | null => {
    if (!url || url.startsWith("#") || SAFE_LINK.test(url)) return null;
    if (isAbsolutePath(url)) return url.split(/[#?]/)[0];
    // Other schemes (vscode:, javascript:, …) are never local files.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return null;
    return basePath ? resolveRelativePath(basePath, url.split("?")[0]) : null;
  };
  const localTargetOf = (url: string): string | null =>
    isLocalMarkdownHref(url) ? localFileOf(url) : null;

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
        // The enclosing <li> carries its source line (rehypeSourceLines), which
        // maps the click back to the right task even past code samples.
        return (
          <input
            type="checkbox"
            checked={!!props.checked}
            onChange={(e) => {
              const line = Number(e.currentTarget.closest("li")?.dataset.sourceLine);
              if (line) onToggleTask(line);
            }}
          />
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
            const hash = url.indexOf("#");
            const fragment = hash >= 0 ? url.slice(hash) : "";
            if (url.startsWith("#")) {
              const target = document.getElementById(decodeURIComponent(url.slice(1)));
              if (target) {
                onBeforeNavigate?.();
                target.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            } else if (SAFE_LINK.test(url)) {
              openUrl(url).catch(() => {});
            } else if (onOpenLocal) {
              // Markdown opens as a document; other files are routed by the
              // app (code view, or a PDF/image in its default app).
              const file = local ?? localFileOf(url);
              if (file) onOpenLocal(file + fragment);
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
        rehypePlugins={previewRehypePlugins}
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
