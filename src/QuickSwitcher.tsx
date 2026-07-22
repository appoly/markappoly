import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "./Sidebar";
import { fuzzyMatch, fuzzyScorePath } from "./fuzzy";

export type Command = { id: string; label: string; hint?: string };

type Item =
  | { kind: "file"; label: string; detail: string; path: string; starred: boolean }
  | { kind: "command"; label: string; hint?: string; id: string }
  | { kind: "tag"; label: string; count: number; tag: string };

/**
 * ⌘P palette. Type to jump to a file; `>` lists commands; `#` lists vault tags.
 */
export function QuickSwitcher({
  files,
  bookmarks,
  commands,
  tags,
  onOpenFile,
  onRunCommand,
  onOpenTag,
  onClose,
}: {
  files: FileEntry[];
  bookmarks: string[];
  commands: Command[];
  tags: [string, number][];
  onOpenFile: (path: string) => void;
  onRunCommand: (id: string) => void;
  onOpenTag: (tag: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const starred = useMemo(() => new Set(bookmarks.map((b) => b.toLowerCase())), [bookmarks]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();

    if (q.startsWith(">")) {
      const needle = q.slice(1).trim();
      return commands
        .map((c) => ({ c, m: fuzzyMatch(needle, c.label) }))
        .filter((x) => x.m !== null)
        .sort((a, b) => b.m!.score - a.m!.score)
        .map(({ c }) => ({ kind: "command" as const, label: c.label, hint: c.hint, id: c.id }));
    }

    if (q.startsWith("#")) {
      const needle = q.slice(1).trim();
      return tags
        .map(([tag, count]) => ({ tag, count, m: fuzzyMatch(needle, tag) }))
        .filter((x) => x.m !== null)
        .sort((a, b) => b.m!.score - a.m!.score || b.count - a.count)
        .slice(0, 50)
        .map(({ tag, count }) => ({ kind: "tag" as const, label: `#${tag}`, count, tag }));
    }

    const toItem = (f: FileEntry): Item => ({
      kind: "file",
      label: f.name.split(/[\\/]/).pop() ?? f.name,
      detail: f.name,
      path: f.path,
      starred: starred.has(f.path.toLowerCase()),
    });

    if (q === "") {
      const star = files.filter((f) => starred.has(f.path.toLowerCase()));
      const rest = files.filter((f) => !starred.has(f.path.toLowerCase()));
      return [...star, ...rest].slice(0, 50).map(toItem);
    }

    return files
      .map((f) => {
        let score = fuzzyScorePath(q, f.name);
        if (score !== null && starred.has(f.path.toLowerCase())) score += 2;
        return { f, score };
      })
      .filter((x) => x.score !== null)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, 50)
      .map(({ f }) => toItem(f));
  }, [query, files, commands, tags, starred]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "file") onOpenFile(item.path);
    else if (item.kind === "command") onRunCommand(item.id);
    else onOpenTag(item.tag);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        pick(items[selected]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div
      className="qs-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="qs-panel" role="dialog" aria-label="Quick switcher">
        <input
          ref={inputRef}
          className="qs-input"
          placeholder="Jump to a file…  ( > commands, # tags )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        <div className="qs-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="qs-empty">
              {files.length === 0 && !query.startsWith(">")
                ? "Open a folder to jump between files."
                : "No matches."}
            </div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.kind === "file" ? item.path : item.label}
                className={"qs-item" + (i === selected ? " selected" : "")}
                data-selected={i === selected}
                onMouseEnter={() => setSelected(i)}
                onClick={() => pick(item)}
              >
                {item.kind === "file" ? (
                  <>
                    <span className="qs-label">
                      {item.starred && <span className="qs-star">★ </span>}
                      {item.label}
                    </span>
                    <span className="qs-detail">{item.detail}</span>
                  </>
                ) : item.kind === "command" ? (
                  <>
                    <span className="qs-label">{item.label}</span>
                    {item.hint && <span className="qs-detail">{item.hint}</span>}
                  </>
                ) : (
                  <>
                    <span className="qs-label">{item.label}</span>
                    <span className="qs-detail">
                      {item.count} {item.count === 1 ? "note" : "notes"}
                    </span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
