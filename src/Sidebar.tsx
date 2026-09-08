import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Heading } from "./markdown";
import { buildFolderTree, type TreeNode } from "./folderTree";
import { basename } from "./paths";
import type { Backlink } from "./vault";

export type FileEntry = { name: string; path: string };
type SearchHit = { path: string; name: string; line: number; text: string };

function FileTree({
  nodes,
  activePath,
  onOpenFile,
  depth = 0,
}: {
  nodes: TreeNode[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul
      className="file-list"
      style={depth === 0 ? undefined : { paddingLeft: 0 }}
    >
      {nodes.map((n) =>
        n.kind === "dir" ? (
          <FolderNode
            key={`d:${n.name}:${depth}`}
            node={n}
            activePath={activePath}
            onOpenFile={onOpenFile}
            depth={depth}
          />
        ) : (
          <li key={n.path}>
            <button
              className={"file-item" + (n.path === activePath ? " active" : "")}
              style={{ paddingLeft: 14 + depth * 12 }}
              onClick={() => onOpenFile(n.path)}
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
  activePath,
  onOpenFile,
  depth,
}: {
  node: Extract<TreeNode, { kind: "dir" }>;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  depth: number;
}) {
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

  return (
    <li className="tree-folder">
      <button
        className="folder-item"
        style={{ paddingLeft: 14 + depth * 12 }}
        onClick={() => setOpen((o) => !o)}
        title={node.name}
        aria-expanded={open}
      >
        <span className="folder-chevron">{open ? "▾" : "▸"}</span>
        {node.name}
      </button>
      {open && (
        <FileTree
          nodes={node.children}
          activePath={activePath}
          onOpenFile={onOpenFile}
          depth={depth + 1}
        />
      )}
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
  query,
  onQueryChange,
  bookmarks,
  onToggleBookmark,
  backlinks,
  onReplaceAll,
  searchNonce = 0,
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
  query: string;
  onQueryChange: (q: string) => void;
  bookmarks: string[];
  onToggleBookmark: (path: string) => void;
  backlinks: Backlink[];
  /** Replace every occurrence of the current query across the folder. */
  onReplaceAll?: (query: string, replacement: string) => void;
  /** Bumped after a folder-wide replace so the hit list refreshes. */
  searchNonce?: number;
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
  const tree = useMemo(() => buildFolderTree(files), [files]);

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
          <div className="sidebar-title">
            <span>{folderName ?? "Files"}</span>
            <button className="link-btn" onClick={onOpenFolder}>
              Open Folder…
            </button>
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

          {searchActive ? (
            hits.length === 0 ? (
              <div className="sidebar-empty">
                {searchError
                  ? "Could not search this folder. Try reopening it."
                  : searching
                    ? "Searching…"
                    : "No matches. Try another search."}
              </div>
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
            <FileTree
              nodes={tree}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
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
                      title={h.text}
                    >
                      {h.text || "(untitled)"}
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
