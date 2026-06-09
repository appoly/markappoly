import type { Heading } from "./markdown";

export type FileEntry = { name: string; path: string };

export function Sidebar({
  files,
  folderName,
  activePath,
  onOpenFile,
  onOpenFolder,
  headings,
  onGotoHeading,
}: {
  files: FileEntry[];
  folderName: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
  headings: Heading[];
  onGotoHeading: (h: Heading) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>{folderName ?? "Files"}</span>
          <button className="link-btn" onClick={onOpenFolder}>
            Open Folder…
          </button>
        </div>
        {files.length === 0 ? (
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
