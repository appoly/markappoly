import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { DiffView } from "./DiffView";
import { basename } from "./paths";

type Snapshot = { ts: number; path: string; size: number };

function relTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * File History: snapshots taken before each save (and before folder-wide
 * replace), diffed against the current document, restorable with one click.
 */
export function HistoryView({
  path,
  currentSource,
  dark,
  onRestore,
  onClose,
}: {
  path: string;
  currentSource: string;
  dark: boolean;
  onRestore: (text: string) => void;
  onClose: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    invoke<Snapshot[]>("list_snapshots", { path })
      .then((list) => {
        setSnapshots(list);
        setSelected(list[0] ?? null);
      })
      .catch(() => setSnapshots([]));
  }, [path]);

  useEffect(() => {
    if (!selected) {
      setText(null);
      return;
    }
    let live = true;
    setText(null);
    setLoadFailed(false);
    invoke<string>("read_file", { path: selected.path })
      .then((t) => {
        if (live) setText(t);
      })
      .catch(() => {
        // A missing/unreadable snapshot must never masquerade as empty
        // content — Restore would wipe the document.
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [selected]);

  const restore = async () => {
    if (text === null) return;
    const ok = await ask(
      `Replace the current contents of ${basename(path)} with this snapshot? The document stays unsaved until you save it.`,
      { title: "Restore snapshot", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    onRestore(text);
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card history-card" role="dialog" aria-label="File history">
        <header className="modal-head">
          <h2>File History — {basename(path)}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="history-body">
          <aside className="history-list">
            {snapshots === null ? (
              <div className="sidebar-empty">Loading…</div>
            ) : snapshots.length === 0 ? (
              <div className="sidebar-empty">
                No snapshots yet. One is kept each time you save.
              </div>
            ) : (
              snapshots.map((s) => (
                <button
                  key={s.ts}
                  className={"history-item" + (selected?.ts === s.ts ? " active" : "")}
                  onClick={() => setSelected(s)}
                >
                  <span>{relTime(s.ts)}</span>
                  <span className="history-size">{(s.size / 1024).toFixed(1)} KB</span>
                </button>
              ))
            )}
          </aside>
          <div className="history-diff">
            {loadFailed ? (
              <div className="sidebar-empty">This snapshot could not be read.</div>
            ) : selected && text !== null ? (
              text === currentSource ? (
                <div className="sidebar-empty">This snapshot matches the current document.</div>
              ) : (
                <DiffView a={text} b={currentSource} dark={dark} />
              )
            ) : (
              <div className="sidebar-empty">{selected ? "Loading…" : "Select a snapshot"}</div>
            )}
          </div>
        </div>
        <footer className="history-foot">
          <span className="set-hint">Snapshot on the left, current document on the right.</span>
          <span className="spacer" />
          <button className="fmt" onClick={restore} disabled={text === null || text === currentSource}>
            Restore this snapshot
          </button>
        </footer>
      </div>
    </div>
  );
}
