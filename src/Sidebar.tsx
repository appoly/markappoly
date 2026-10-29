import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Heading } from "./markdown";
import { buildFolderTree, type TreeNode, type TreeSort } from "./folderTree";
import { basename, dirOf } from "./paths";
import type { Backlink } from "./vault";

export type FileEntry = { name: string; path: string; mtime?: number };
type SearchHit = { path: string; name: string; line: number; text: string };

/** How many file-name matches to list above the line matches. */
const NAME_HIT_LIMIT = 8;

function joinPath(dir: string, rel: string): string {
  if (!rel) return dir;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

/**
 * Pointer-driven drag and drop for the folder tree. (HTML5 drag events are
 * swallowed by the webview's own file-drop handling on some platforms.)
 * Rows carry `data-drag-path`; drop targets carry `data-drop-dir`.
 */
function useTreeDrag(onMove?: (from: string, toDir: string) => void) {
  const [drag, setDrag] = useState<{ path: string; x: number; y: number; over: string | null } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (!onMove) return;
    let start: { path: string; x: number; y: number } | null = null;
    let active = false;
    const targetAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-drop-dir]") as HTMLElement | null)
        ?.dataset.dropDir ?? null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-drag-path]");
      if (!row) return;
      start = { path: row.dataset.dragPath!, x: e.clientX, y: e.clientY };
      active = false;
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      if (!active && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      active = true;
      e.preventDefault();
      setDrag({ path: start.path, x: e.clientX, y: e.clientY, over: targetAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      if (start && active) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        const dir = targetAt(e.clientX, e.clientY);
        const from = start.path;
        if (dir && dir !== dirOf(from) && dir !== from) onMove(from, dir);
      }
      start = null;
      active = false;
      setDrag(null);
    };
    const cancel = () => {
      start = null;
      active = false;
      setDrag(null);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", cancel);
    };
  }, [onMove]);
  return { drag, suppressClick };
}

type TreeCtx = {
  activePath: string | null;
  onOpenFile: (path: string) => void;
  root: string | null;
  dropOver: string | null;
  suppressClick: MutableRefObject<boolean>;
};

function FileTree({
  nodes,
  ctx,
  depth = 0,
}: {
  nodes: TreeNode[];
  ctx: TreeCtx;
  depth?: number;
}) {
  return (
    <ul
      className="file-list"
      style={depth === 0 ? undefined : { paddingLeft: 0 }}
    >
      {nodes.map((n) =>
        n.kind === "dir" ? (
          <FolderNode key={`d:${n.rel}`} node={n} ctx={ctx} depth={depth} />
        ) : (
          <li key={n.path} data-drop-dir={ctx.root ? dirOf(n.path) : undefined}>
            <button
              className={"file-item" + (n.path === ctx.activePath ? " active" : "")}
              style={{ paddingLeft: 14 + depth * 12 }}
              data-drag-path={ctx.root ? n.path : undefined}
              onClick={() => {
                if (!ctx.suppressClick.current) ctx.onOpenFile(n.path);
              }}
              title={n.path}
            >
              {n.name}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function FolderNode({
  node,
  ctx,
  depth,
}: {
  node: Extract<TreeNode, { kind: "dir" }>;
  ctx: TreeCtx;
  depth: number;
}) {
  const { activePath } = ctx;
  // Auto-expand if the active file lives under this folder.
  const containsActive = useMemo(() => {
    if (!activePath) return false;
    const walk = (nodes: TreeNode[]): boolean =>
      nodes.some((n) =>
        n.kind === "file" ? n.path === activePath : walk(n.children),
      );
    return walk(node.children);
  }, [node, activePath]);

  const [open, setOpen] = useState(depth < 1 || containsActive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const abs = ctx.root ? joinPath(ctx.root, node.rel) : null;
  return (
    <li className="tree-folder">
      <button
        className={"folder-item" + (abs && ctx.dropOver === abs ? " drop-target" : "")}
        style={{ paddingLeft: 14 + depth * 12 }}
        data-drag-path={abs ?? undefined}
        data-drop-dir={abs ?? undefined}
        onClick={() => {
          if (!ctx.suppressClick.current) setOpen((o) => !o);
        }}
        title={node.name}
        aria-expanded={open}
      >
        <span className="folder-chevron">{open ? "▾" : "▸"}</span>
        {node.name}
      </button>
      {open && <FileTree nodes={node.children} ctx={ctx} depth={depth + 1} />}
    </li>
  );
}

export function Sidebar({
  files,
  folderName,
  folderPath,
  activePath,
  onOpenFile,
  onOpenFolder,
  onOpenAtLine,
  headings,
  onGotoHeading,
  activeHeadingSlug,
  changedSlugs,
  query,
  onQueryChange,
  bookmarks,
  onToggleBookmark,
  backlinks,
  onReplaceAll,
  searchNonce = 0,
  onMovePath,
}: {
  files: FileEntry[];
  folderName: string | null;
  folderPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
  onOpenAtLine: (path: string, line: number) => void;
  headings: Heading[];
  onGotoHeading: (h: Heading) => void;
  activeHeadingSlug?: string | null;
  /** Sections holding changes the reader hasn't reviewed yet. */
  changedSlugs?: Set<string>;
  query: string;
  onQueryChange: (q: string) => void;
  bookmarks: string[];
  onToggleBookmark: (path: string) => void;
  backlinks: Backlink[];
  /** Replace every occurrence of the current query across the folder. */
  onReplaceAll?: (query: string, replacement: string) => void;
  /** Bumped after a folder-wide replace so the hit list refreshes. */
  searchNonce?: number;
  /** Move a file or folder (dragged in the tree) into another folder. */
  onMovePath?: (from: string, toDir: string) => void;
}) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("mv.sidebarWidth") || 248);
    return Number.isFinite(saved) ? Math.max(190, Math.min(420, saved)) : 248;
  });
  const resize = (next: number) => {
    const value = Math.max(190, Math.min(420, next, window.innerWidth * 0.45));
    setWidth(value);
    localStorage.setItem("mv.sidebarWidth", String(value));
  };
  const [searchError, setSearchError] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [sort, setSort] = useState<TreeSort>("name");
  const sortKey = folderPath ? `mv.treeSort:${folderPath}` : null;
  useEffect(() => {
    setSort(sortKey && localStorage.getItem(sortKey) === "modified" ? "modified" : "name");
  }, [sortKey]);
  const toggleSort = () => {
    const next: TreeSort = sort === "name" ? "modified" : "name";
    setSort(next);
    if (sortKey) localStorage.setItem(sortKey, next);
  };
  const tree = useMemo(() => buildFolderTree(files, sort), [files, sort]);
  const { drag, suppressClick } = useTreeDrag(folderPath ? onMovePath : undefined);
  const treeCtx: TreeCtx = {
    activePath,
    onOpenFile,
    root: folderPath,
    dropOver: drag?.over ?? null,
    suppressClick,
  };
  const nameHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return files
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Matches in the file's own name beat matches in its folder path.
        const an = basename(a.name).toLowerCase().includes(q) ? 0 : 1;
        const bn = basename(b.name).toLowerCase().includes(q) ? 0 : 1;
        return an - bn || a.name.length - b.name.length;
      })
      .slice(0, NAME_HIT_LIMIT);
  }, [files, query]);

  useEffect(() => {
    if (!folderPath || query.trim() === "") {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(false);
    const timer = setTimeout(async () => {
      try {
        const res = await invoke<SearchHit[]>("search_dir", {
          path: folderPath,
          query,
        });
        if (!cancelled) setHits(res);
      } catch {
        if (!cancelled) {
          setHits([]);
          setSearchError(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [folderPath, query, searchNonce]);

  const searchActive = !!folderPath && query.trim() !== "";

  return (
    <aside className="sidebar" aria-label="Navigation" style={{ width }}>
      <div className="sidebar-sections">
        {bookmarks.length > 0 && (
          <details className="sidebar-section" open>
            <summary className="sidebar-title">Bookmarks</summary>
            <ul className="file-list">
              {bookmarks.map((p) => (
                <li key={p} className="bookmark-row">
                  <button
                    className={
                      "file-item" + (p === activePath ? " active" : "")
                    }
                    onClick={() => onOpenFile(p)}
                    title={p}
                  >
                    {basename(p)}
                  </button>
                  <button
                    className="bookmark-remove"
                    title="Remove bookmark"
                    aria-label={`Remove bookmark for ${basename(p)}`}
                    onClick={() => onToggleBookmark(p)}
                  >
                    ★
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="sidebar-section files-section">
          <div
            className={
              "sidebar-title" +
              (folderPath && drag?.over === folderPath ? " drop-target" : "")
            }
            data-drop-dir={folderPath ?? undefined}
          >
            <span>{folderName ?? "Files"}</span>
            <span className="sidebar-title-actions">
              {folderPath && files.length > 0 && (
                <button
                  className="link-btn"
                  onClick={toggleSort}
                  title={
                    sort === "name"
                      ? "Sorted by name. Click to sort by last edit"
                      : "Sorted by last edit. Click to sort by name"
                  }
                >
                  {sort === "name" ? "A–Z" : "Recent"}
                </button>
              )}
              <button className="link-btn" onClick={onOpenFolder}>
                Open Folder…
              </button>
            </span>
          </div>

          {folderPath && (
            <input
              className="sidebar-search"
              aria-label="Search this folder"
              placeholder="Search this folder…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          )}

          {searchActive && onReplaceAll && (
            <div className="replace-row">
              {replaceOpen ? (
                <>
                  <input
                    className="sidebar-search"
                    aria-label="Replace with"
                    placeholder="Replace with…"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onReplaceAll(query, replacement);
                      }
                    }}
                  />
                  <button
                    className="fmt"
                    disabled={hits.length === 0}
                    title="Case-sensitive; a snapshot of each changed file is kept in File History"
                    onClick={() => onReplaceAll(query, replacement)}
                  >
                    Replace all
                  </button>
                  <button
                    className="fmt"
                    title="Hide replace"
                    onClick={() => setReplaceOpen(false)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  className="link-btn"
                  onClick={() => setReplaceOpen(true)}
                >
                  Replace…
                </button>
              )}
            </div>
          )}

          {searchActive && nameHits.length > 0 && (
            <ul className="file-list name-hits" aria-label="Files">
              {nameHits.map((f) => (
                <li key={f.path}>
                  <button
                    className={"file-item" + (f.path === activePath ? " active" : "")}
                    onClick={() => onOpenFile(f.path)}
                    title={f.path}
                  >
                    {basename(f.name)}
                    {f.name !== basename(f.name) && (
                      <span className="name-hit-dir">{dirOf(f.name)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchActive ? (
            hits.length === 0 ? (
              nameHits.length > 0 && !searchError ? null : (
              <div className="sidebar-empty">
                {searchError
                  ? "Could not search this folder. Try reopening it."
                  : searching
                    ? "Searching…"
                    : "No matches. Try another search."}
              </div>
              )
            ) : (
              <ul className="file-list">
                {hits.map((h, i) => (
                  <li key={`${h.path}:${h.line}:${i}`}>
                    <button
                      className="search-hit"
                      onClick={() => onOpenAtLine(h.path, h.line)}
                      title={`${h.name}:${h.line}`}
                    >
                      <span className="search-hit-file">
                        {h.name}
                        <span className="search-hit-line">:{h.line}</span>
                      </span>
                      <span className="search-hit-text">{h.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : files.length === 0 ? (
            <div className="sidebar-empty">
              {folderPath
                ? "No Markdown files in this folder"
                : "Open a folder to browse your notes"}
            </div>
          ) : (
            <FileTree nodes={tree} ctx={treeCtx} />
          )}
        </div>

        {headings.length > 0 && (
          <details className="sidebar-section" open>
            <summary className="sidebar-title">Outline</summary>
            {headings.length === 0 ? (
              <div className="sidebar-empty">No headings</div>
            ) : (
              <ul className="outline-list">
                {headings.map((h, i) => (
                  <li
                    key={`${h.slug}:${i}`}
                    style={{ paddingLeft: 4 + (h.depth - 1) * 12 }}
                  >
                    <button
                      className={
                        "outline-item" +
                        (activeHeadingSlug && h.slug === activeHeadingSlug
                          ? " active"
                          : "")
                      }
                      onClick={() => onGotoHeading(h)}
                      title={
                        changedSlugs?.has(h.slug) ? `${h.text} (changed)` : h.text
                      }
                    >
                      {h.text || "(untitled)"}
                      {changedSlugs?.has(h.slug) && (
                        <span className="outline-changed" aria-label="changed" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}

        {folderPath && activePath && (
          <details className="sidebar-section">
            <summary className="sidebar-title">
              <span>
                Backlinks
                {backlinks.length > 0 && (
                  <span className="sidebar-count">{backlinks.length}</span>
                )}
              </span>
            </summary>
            {backlinks.length === 0 ? (
              <div className="sidebar-empty">Nothing links here yet</div>
            ) : (
              <ul className="file-list">
                {backlinks.map((b) => (
                  <li key={b.path} className="backlink-group">
                    {b.contexts.map((c, i) => (
                      <button
                        key={`${b.path}:${c.line}:${i}`}
                        className="search-hit"
                        onClick={() => onOpenAtLine(b.path, c.line)}
                        title={`${b.name}:${c.line}`}
                      >
                        {i === 0 && (
                          <span className="search-hit-file">
                            {b.name}
                            <span className="search-hit-line">:{c.line}</span>
                          </span>
                        )}
                        <span className="search-hit-text">{c.text}</span>
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </div>
      {drag && (
        <div
          className="tree-drag-ghost"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
          aria-hidden="true"
        >
          {basename(drag.path)}
        </div>
      )}
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize navigation"
        aria-orientation="vertical"
        aria-valuemin={190}
        aria-valuemax={420}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            resize(width + (e.key === "ArrowRight" ? 16 : -16));
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(e.clientX);
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      />
    </aside>
  );
}
