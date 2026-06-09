import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search, openSearchPanel } from "@codemirror/search";
import { Preview, extractHeadings, type Heading } from "./markdown";
import { FindBar } from "./FindBar";
import { Sidebar, type FileEntry } from "./Sidebar";
import { TabBar } from "./TabBar";
import { DiffView } from "./DiffView";
import { usePreferences, type ThemePref } from "./prefs";
import {
  markdownToHtml,
  markdownToAst,
  htmlDocument,
  markdownToDocxBase64,
} from "./export";
import "./App.css";

type Mode = "preview" | "edit";
type ExportKind = "txt" | "html" | "json" | "docx" | "pdf";

type Doc = {
  id: string;
  path: string | null;
  source: string;
  dirty: boolean;
  mtime: number | null;
};

const MD_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"];

const WELCOME = `# Markappoly

> **Pass Go, straight to preview.** A fast, cross-platform viewer for **formatted Markdown** — built with Tauri + React.

## What works

- Open any \`.md\` file (or a whole folder) and read it nicely formatted
- Toggle to **Edit** mode (⌘E) — a formatting toolbar appears
- **Export** to TXT, HTML, JSON, Word or PDF
- Open several files as **tabs**, and **Compare** two of them side by side
- Math, diagrams, an outline, find (⌘F), live reload, and more

### Math & diagrams

Inline math like $e^{i\\pi} + 1 = 0$ and blocks render via KaTeX.

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview]
  B --> C[Export]
\`\`\`

- [x] Render Markdown
- [ ] Try ticking this box

> Open a file with ⌘O, or drag one onto the window.
`;

function basename(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? "Untitled";
}

function docName(d: Doc): string {
  return d.path ? basename(d.path) : "Untitled";
}

function makeDoc(partial: Partial<Doc> = {}): Doc {
  return {
    id: crypto.randomUUID(),
    path: null,
    source: "",
    dirty: false,
    mtime: null,
    ...partial,
  };
}

function App() {
  const prefs = usePreferences();
  const first = useRef<Doc | null>(null);
  if (first.current === null) first.current = makeDoc({ source: WELCOME });

  const [docs, setDocs] = useState<Doc[]>(() => [first.current!]);
  const [activeId, setActiveId] = useState<string>(() => first.current!.id);
  const [mode, setMode] = useState<Mode>("preview");
  const [compare, setCompare] = useState<{ aId: string; bId: string } | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);

  // Always-fresh references so stable callbacks can read current state.
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  const source = active.source;
  const dirty = active.dirty;
  const filePath = active.path;

  const headings = useMemo(() => extractHeadings(source), [source]);
  const wordCount = useMemo(() => (source.trim().match(/\S+/g) || []).length, [source]);
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  const getActive = useCallback(
    () => docsRef.current.find((d) => d.id === activeIdRef.current) ?? docsRef.current[0],
    [],
  );
  const patchDocById = useCallback((id: string, patch: Partial<Doc>) => {
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  // ----- Tabs -----
  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    setCompare(null);
  }, []);

  const newDoc = useCallback(() => {
    const doc = makeDoc({ source: "" });
    setDocs((ds) => [...ds, doc]);
    setActiveId(doc.id);
    setCompare(null);
    setMode("edit");
  }, []);

  const closeTab = useCallback((id: string) => {
    const cur = docsRef.current;
    const doc = cur.find((d) => d.id === id);
    if (!doc) return;
    if (doc.dirty && !window.confirm(`Discard unsaved changes to ${docName(doc)}?`)) return;
    const idx = cur.findIndex((d) => d.id === id);
    const next = cur.filter((d) => d.id !== id);
    if (next.length === 0) {
      const fresh = makeDoc({ source: "" });
      setDocs([fresh]);
      setActiveId(fresh.id);
      setCompare(null);
      return;
    }
    setDocs(next);
    if (activeIdRef.current === id) {
      setActiveId(next[Math.min(idx, next.length - 1)].id);
    }
    setCompare((c) => (c && (c.aId === id || c.bId === id) ? null : c));
  }, []);

  // ----- Open / save -----
  const openPath = useCallback(async (path: string) => {
    const existing = docsRef.current.find((d) => d.path === path);
    if (existing) {
      setActiveId(existing.id);
      setCompare(null);
      return;
    }
    try {
      const text = await invoke<string>("read_file", { path });
      let mtime: number | null = null;
      try {
        mtime = await invoke<number>("file_mtime", { path });
      } catch {
        /* ignore */
      }
      const doc = makeDoc({ path, source: text, dirty: false, mtime });
      setDocs((ds) => [...ds, doc]);
      setActiveId(doc.id);
      setCompare(null);
      setMode("preview");
    } catch (e) {
      console.error("open failed", e);
    }
  }, []);

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: MD_EXTENSIONS }],
    });
    if (typeof selected === "string") openPath(selected);
  }, [openPath]);

  const openFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setFolderPath(dir);
    try {
      setFiles(await invoke<FileEntry[]>("list_markdown_dir", { path: dir }));
    } catch (e) {
      console.error(e);
      setFiles([]);
    }
  }, []);

  const reloadFile = useCallback(async () => {
    const doc = getActive();
    if (!doc.path) return;
    const text = await invoke<string>("read_file", { path: doc.path });
    let mtime: number | null = null;
    try {
      mtime = await invoke<number>("file_mtime", { path: doc.path });
    } catch {
      /* ignore */
    }
    patchDocById(doc.id, { source: text, dirty: false, mtime });
  }, [getActive, patchDocById]);

  const saveFile = useCallback(async () => {
    const doc = getActive();
    let path = doc.path;
    if (!path) {
      const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!chosen) return;
      path = chosen;
    }
    await invoke("write_file", { path, contents: doc.source });
    let mtime: number | null = null;
    try {
      mtime = await invoke<number>("file_mtime", { path });
    } catch {
      /* ignore */
    }
    patchDocById(doc.id, { path, dirty: false, mtime });
  }, [getActive, patchDocById]);

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      const doc = getActive();
      const src = doc.source;
      const name = basename(doc.path).replace(/\.[^.]+$/, "") || "document";

      if (kind === "pdf") {
        setCompare(null);
        setMode("preview");
        setTimeout(() => window.print(), 60);
        return;
      }
      if (kind === "docx") {
        const chosen = await save({
          defaultPath: `${name}.docx`,
          filters: [{ name: "Word Document", extensions: ["docx"] }],
        });
        if (!chosen) return;
        const data = await markdownToDocxBase64(src);
        await invoke("write_file_base64", { path: chosen, data });
        return;
      }

      let contents: string;
      if (kind === "txt") contents = src;
      else if (kind === "html") contents = htmlDocument(basename(doc.path), markdownToHtml(src));
      else contents = JSON.stringify(markdownToAst(src), null, 2);

      const chosen = await save({
        defaultPath: `${name}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!chosen) return;
      await invoke("write_file", { path: chosen, contents });
    },
    [getActive],
  );

  // ----- Compare -----
  const startCompare = useCallback(() => {
    const cur = docsRef.current;
    if (cur.length < 2) return;
    const a = activeIdRef.current;
    const b = (cur.find((d) => d.id !== a) ?? cur[0]).id;
    setCompare({ aId: a, bId: b });
  }, []);

  // ----- Formatting (operate on the active CodeMirror selection) -----
  const wrapSelection = useCallback(
    (before: string, after = before, placeholder = "") => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to) || placeholder;
      view.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: {
          anchor: from + before.length,
          head: from + before.length + selected.length,
        },
      });
      view.focus();
    },
    [],
  );

  const prefixLines = useCallback((prefix: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const firstLine = view.state.doc.lineAt(from).number;
    const lastLine = view.state.doc.lineAt(to).number;
    const changes: { from: number; insert: string }[] = [];
    for (let n = firstLine; n <= lastLine; n++) {
      changes.push({ from: view.state.doc.line(n).from, insert: prefix });
    }
    view.dispatch({ changes });
    view.focus();
  }, []);

  const insertLink = useCallback(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.sliceDoc(from, to) || "text";
    const urlFrom = from + 1 + text.length + 2;
    view.dispatch({
      changes: { from, to, insert: `[${text}](url)` },
      selection: { anchor: urlFrom, head: urlFrom + 3 },
    });
    view.focus();
  }, []);

  const insertCodeBlock = useCallback(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || "code";
    view.dispatch({
      changes: { from, to, insert: "```\n" + selected + "\n```" },
      selection: { anchor: from + 4, head: from + 4 + selected.length },
    });
    view.focus();
  }, []);

  // ----- Interactive task checkboxes (toggle writes back to source) -----
  const toggleTask = useCallback(
    (index: number) => {
      const doc = getActive();
      let i = -1;
      const re = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm;
      const updated = doc.source.replace(re, (full, prefix, c) => {
        i += 1;
        if (i !== index) return full;
        return prefix + (c === " " ? "[x]" : "[ ]");
      });
      if (updated !== doc.source) patchDocById(doc.id, { source: updated, dirty: true });
    },
    [getActive, patchDocById],
  );

  // ----- Outline navigation -----
  const gotoHeading = useCallback(
    (h: Heading) => {
      if (mode === "edit") {
        const view = cmRef.current?.view;
        if (view) {
          const n = Math.min(h.line + 1, view.state.doc.lines);
          const line = view.state.doc.line(n);
          view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          view.focus();
        }
      } else {
        document
          .getElementById(h.slug)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [mode],
  );

  // ----- Live reload: poll the active file's mtime -----
  useEffect(() => {
    const path = active.path;
    const docId = active.id;
    if (!path) return;
    const timer = setInterval(async () => {
      const cur = docsRef.current.find((d) => d.id === docId);
      if (!cur || cur.dirty) return;
      try {
        const m = await invoke<number>("file_mtime", { path });
        if (cur.mtime != null && m !== cur.mtime) {
          const text = await invoke<string>("read_file", { path });
          patchDocById(docId, { source: text, dirty: false, mtime: m });
        }
      } catch {
        /* file may be mid-write or removed */
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [active.id, active.path, patchDocById]);

  // ----- Drag a file onto the window to open it -----
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const p = event.payload.paths?.[0];
          if (p) openPath(p);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [openPath]);

  // ----- Native menu events -----
  const handleMenu = useCallback(
    (id: string) => {
      switch (id) {
        case "open":
          openFile();
          break;
        case "open_folder":
          openFolder();
          break;
        case "save":
          saveFile();
          break;
        case "reload":
          reloadFile();
          break;
        case "toggle_mode":
          setCompare(null);
          setMode((m) => (m === "preview" ? "edit" : "preview"));
          break;
        case "toggle_sidebar":
          prefs.toggleSidebar();
          break;
        case "zoom_in":
          prefs.zoomIn();
          break;
        case "zoom_out":
          prefs.zoomOut();
          break;
        case "zoom_reset":
          prefs.zoomReset();
          break;
        case "find":
          if (mode === "preview") setFindOpen(true);
          else {
            const v = cmRef.current?.view;
            if (v) openSearchPanel(v);
          }
          break;
        default:
          if (id.startsWith("export:")) exportAs(id.slice(7) as ExportKind);
      }
    },
    [
      openFile,
      openFolder,
      saveFile,
      reloadFile,
      mode,
      prefs.toggleSidebar,
      prefs.zoomIn,
      prefs.zoomOut,
      prefs.zoomReset,
      exportAs,
    ],
  );

  useEffect(() => {
    const unlisteners = [
      listen<string>("menu", (e) => handleMenu(e.payload)),
      listen<string>("open-file", (e) => {
        if (e.payload) openPath(e.payload);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, [handleMenu, openPath]);

  useEffect(() => {
    invoke<string | null>("cli_file_arg")
      .then((p) => {
        if (p) openPath(p);
      })
      .catch(() => {});
  }, [openPath]);

  useEffect(() => {
    check()
      .then(async (update) => {
        if (!update) return;
        const yes = await ask(
          `Markappoly ${update.version} is available. Update now? The app will download it and restart.`,
          { title: "Update available", kind: "info", okLabel: "Update", cancelLabel: "Later" },
        );
        if (!yes) return;
        await update.downloadAndInstall();
        await relaunch();
      })
      .catch(() => {});
  }, []);

  // ----- Keyboard shortcuts (chords not owned by the native menu) -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case "t":
          e.preventDefault();
          newDoc();
          break;
        case "w":
          e.preventDefault();
          closeTab(activeIdRef.current);
          break;
        case "r":
          e.preventDefault();
          reloadFile();
          break;
        case "\\":
          e.preventDefault();
          prefs.toggleSidebar();
          break;
        case "=":
        case "+":
          e.preventDefault();
          prefs.zoomIn();
          break;
        case "-":
          e.preventDefault();
          prefs.zoomOut();
          break;
        case "0":
          e.preventDefault();
          prefs.zoomReset();
          break;
        case "b":
          if (mode === "edit") {
            e.preventDefault();
            wrapSelection("**", "**", "bold");
          }
          break;
        case "i":
          if (mode === "edit") {
            e.preventDefault();
            wrapSelection("*", "*", "italic");
          }
          break;
        case "k":
          if (mode === "edit") {
            e.preventDefault();
            insertLink();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    newDoc,
    closeTab,
    reloadFile,
    mode,
    prefs.toggleSidebar,
    prefs.zoomIn,
    prefs.zoomOut,
    prefs.zoomReset,
    wrapSelection,
    insertLink,
  ]);

  const tabs = docs.map((d) => ({ id: d.id, name: docName(d), dirty: d.dirty }));
  const docA = compare ? docs.find((d) => d.id === compare.aId) : undefined;
  const docB = compare ? docs.find((d) => d.id === compare.bId) : undefined;

  return (
    <div className="app">
      <header className="toolbar" data-tauri-drag-region>
        <div className="toolbar-group">
          <button className="icon-btn" onClick={prefs.toggleSidebar} title="Toggle sidebar (⌘\)">
            ☰
          </button>
          <button onClick={openFile} title="Open (⌘O)">
            Open
          </button>
          <button onClick={saveFile} title="Save (⌘S)" disabled={!dirty && !!filePath}>
            Save
          </button>
          <button onClick={reloadFile} title="Reload (⌘R)" disabled={!filePath}>
            Reload
          </button>
        </div>

        <div className="toolbar-group segmented">
          <button
            className={!compare && mode === "preview" ? "active" : ""}
            onClick={() => {
              setCompare(null);
              setMode("preview");
            }}
          >
            Preview
          </button>
          <button
            className={!compare && mode === "edit" ? "active" : ""}
            onClick={() => {
              setCompare(null);
              setMode("edit");
            }}
          >
            Edit
          </button>
          <button
            className={compare ? "active" : ""}
            onClick={startCompare}
            disabled={docs.length < 2}
            title="Compare two open files"
          >
            Compare
          </button>
        </div>

        <div className="spacer" data-tauri-drag-region />

        <div className="toolbar-group">
          <select
            className="export-select"
            value={prefs.theme}
            onChange={(e) => prefs.setTheme(e.target.value as ThemePref)}
            title="Theme"
          >
            <option value="system">Theme: System</option>
            <option value="light">Theme: Light</option>
            <option value="dark">Theme: Dark</option>
          </select>
          <button className="icon-btn" onClick={prefs.zoomOut} title="Zoom out (⌘-)">
            −
          </button>
          <button className="icon-btn zoom-label" onClick={prefs.zoomReset} title="Reset zoom (⌘0)">
            {Math.round(prefs.zoom * 100)}%
          </button>
          <button className="icon-btn" onClick={prefs.zoomIn} title="Zoom in (⌘+)">
            +
          </button>
          <select
            className="export-select"
            value=""
            onChange={(e) => {
              const v = e.target.value as ExportKind;
              if (v) exportAs(v);
              e.target.value = "";
            }}
          >
            <option value="">Export…</option>
            <option value="txt">Text (.txt)</option>
            <option value="html">HTML (.html)</option>
            <option value="json">JSON AST (.json)</option>
            <option value="docx">Word (.docx)</option>
            <option value="pdf">PDF (print)</option>
          </select>
        </div>
      </header>

      <div className="body">
        {prefs.sidebarOpen && (
          <Sidebar
            files={files}
            folderName={folderPath ? basename(folderPath) : null}
            activePath={filePath}
            onOpenFile={openPath}
            onOpenFolder={openFolder}
            headings={headings}
            onGotoHeading={gotoHeading}
          />
        )}

        <div className="main-col">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={selectTab}
            onClose={closeTab}
            onNew={newDoc}
          />

          {compare ? (
            <div className="compare-bar">
              <select
                value={compare.aId}
                onChange={(e) => setCompare((c) => c && { ...c, aId: e.target.value })}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {docName(d)}
                  </option>
                ))}
              </select>
              <span className="compare-vs">↔</span>
              <select
                value={compare.bId}
                onChange={(e) => setCompare((c) => c && { ...c, bId: e.target.value })}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {docName(d)}
                  </option>
                ))}
              </select>
              <span className="spacer" />
              <button className="fmt" onClick={() => setCompare(null)}>
                Close compare
              </button>
            </div>
          ) : (
            mode === "edit" && (
              <div className="format-bar">
                <button className="fmt fmt-b" title="Bold (⌘B)" onClick={() => wrapSelection("**", "**", "bold")}>
                  B
                </button>
                <button className="fmt fmt-i" title="Italic (⌘I)" onClick={() => wrapSelection("*", "*", "italic")}>
                  I
                </button>
                <button className="fmt fmt-s" title="Strikethrough" onClick={() => wrapSelection("~~", "~~", "text")}>
                  S
                </button>
                <span className="sep" />
                <button className="fmt" title="Heading 1" onClick={() => prefixLines("# ")}>
                  H1
                </button>
                <button className="fmt" title="Heading 2" onClick={() => prefixLines("## ")}>
                  H2
                </button>
                <button className="fmt" title="Heading 3" onClick={() => prefixLines("### ")}>
                  H3
                </button>
                <span className="sep" />
                <button className="fmt" title="Bulleted list" onClick={() => prefixLines("- ")}>
                  • List
                </button>
                <button className="fmt" title="Numbered list" onClick={() => prefixLines("1. ")}>
                  1. List
                </button>
                <button className="fmt" title="Task list" onClick={() => prefixLines("- [ ] ")}>
                  ☐ Task
                </button>
                <button className="fmt" title="Blockquote" onClick={() => prefixLines("> ")}>
                  ❝ Quote
                </button>
                <span className="sep" />
                <button className="fmt" title="Inline code" onClick={() => wrapSelection("`", "`", "code")}>
                  {"</>"}
                </button>
                <button className="fmt" title="Code block" onClick={insertCodeBlock}>
                  { } Block
                </button>
                <button className="fmt" title="Link (⌘K)" onClick={insertLink}>
                  🔗 Link
                </button>
              </div>
            )
          )}

          {findOpen && !compare && mode === "preview" && (
            <FindBar container={contentRef.current} onClose={() => setFindOpen(false)} />
          )}

          <main className="content" ref={contentRef}>
            {compare ? (
              <DiffView a={docA?.source ?? ""} b={docB?.source ?? ""} dark={prefs.dark} />
            ) : mode === "preview" ? (
              <div className="markdown-body">
                <Preview source={source} dark={prefs.dark} onToggleTask={toggleTask} />
              </div>
            ) : (
              <CodeMirror
                key={active.id}
                ref={cmRef}
                className="editor"
                value={source}
                height="100%"
                theme={prefs.dark ? "dark" : "light"}
                extensions={[markdown(), search()]}
                onChange={(value) => patchDocById(active.id, { source: value, dirty: true })}
              />
            )}
          </main>

          <footer className="status-bar">
            <span>
              {compare
                ? `Comparing ${docName(docA ?? active)} ↔ ${docName(docB ?? active)}`
                : `${docName(active)}${dirty ? " •" : ""}`}
            </span>
            <span>
              {wordCount} words · {readMin} min read
              {compare ? " · Compare" : mode === "edit" ? " · Edit" : ""}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
