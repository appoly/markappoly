import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Heading } from "./markdown";

export type FileEntry = { name: string; path: string };
type SearchHit = { path: string; name: string; line: number; text: string };

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
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

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
            onChange={(e) => setQuery(e.target.value)}
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
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  className={"file-item" + (f.path === activePath ? " active" : "")}
                  onClick={() => onOpenFile(f.path)}
                  title={f.name}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
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
              <li key={i} style={{ paddingLeft: 4 + (h.depth - 1) * 12 }}>
                <button
                  className="outline-item"
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
    </aside>
  );
}
