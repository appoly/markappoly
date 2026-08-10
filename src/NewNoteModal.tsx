import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "./Sidebar";
import { basename } from "./paths";
import { noteFileName } from "./template";

/**
 * Create a note in the open folder, optionally from a template. Templates are
 * the files inside the configured templates folder; {{title}}, {{date}} and
 * {{time}} are substituted on creation.
 */
export function NewNoteModal({
  folderName,
  templates,
  onCreate,
  onClose,
}: {
  folderName: string;
  templates: FileEntry[];
  onCreate: (name: string, templatePath: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    const fileName = noteFileName(name);
    if (!fileName) {
      setError("Give the note a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onCreate(name, template || null);
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card new-note-card" role="dialog" aria-label="New note">
        <header className="modal-head">
          <h2>New note</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <label className="set-row">
            <span className="set-label">Name</span>
            <input
              ref={inputRef}
              className="set-text"
              placeholder="Meeting notes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </label>
          <label className="set-row">
            <span className="set-label">Template</span>
            <select
              className="set-text"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Empty note</option>
              {templates.map((t) => (
                <option key={t.path} value={t.path}>
                  {basename(t.path).replace(/\.[^.]+$/, "")}
                </option>
              ))}
            </select>
          </label>
          <p className="set-note">
            Created in <strong>{folderName}</strong>
            {name.trim() ? ` as ${noteFileName(name)}` : ""}.
          </p>
          {error && <p className="set-error">{error}</p>}
        </div>
        <footer className="history-foot">
          <span className="spacer" />
          <button className="fmt" onClick={onClose}>
            Cancel
          </button>
          <button className="fmt fmt-primary" onClick={create} disabled={busy}>
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
