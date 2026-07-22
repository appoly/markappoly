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
    <ul className="file-list" style={depth === 0 ? undefined : { paddingLeft: 0 }}>
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
      nodes.some((n) => (n.kind === "file" ? n.path === activePath : walk(n.children)));
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
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const tree = useMemo(() => buildFolderTree(files), [files]);

  useEffect(() => {
    if (!folderPath || query.trim() === "") {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await invoke<SearchHit[]>("search_dir", { path: folderPath, query });
        if (!cancelled) setHits(res);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [folderPath, query]);

  const searchActive = !!folderPath && query.trim() !== "";

  return (
    <aside className="sidebar">
      {bookmarks.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>Bookmarks</span>
          </div>
          <ul className="file-list">
            {bookmarks.map((p) => (
              <li key={p} className="bookmark-row">
                <button
                  className={"file-item" + (p === activePath ? " active" : "")}
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
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>{folderName ?? "Files"}</span>
          <button className="link-btn" onClick={onOpenFolder}>
            Open Folder…
          </button>
        </div>

        {folderPath && (
          <input
            className="sidebar-search"
            placeholder="Search this folder…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        )}

        {searchActive ? (
          hits.length === 0 ? (
            <div className="sidebar-empty">{searching ? "Searching…" : "No matches"}</div>
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
          <div className="sidebar-empty">No folder open</div>
        ) : (
          <FileTree nodes={tree} activePath={activePath} onOpenFile={onOpenFile} />
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Outline</span>
        </div>
        {headings.length === 0 ? (
          <div className="sidebar-empty">No headings</div>
        ) : (
          <ul className="outline-list">
            {headings.map((h, i) => (
              <li key={`${h.slug}:${i}`} style={{ paddingLeft: 4 + (h.depth - 1) * 12 }}>
                <button
                  className={
                    "outline-item" + (activeHeadingSlug && h.slug === activeHeadingSlug ? " active" : "")
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
      </div>

      {folderPath && activePath && (
        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>
              Backlinks
              {backlinks.length > 0 && <span className="sidebar-count">{backlinks.length}</span>}
            </span>
          </div>
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
        </div>
      )}
    </aside>
  );
}
