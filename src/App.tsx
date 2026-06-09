import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search, openSearchPanel } from "@codemirror/search";
import { Preview, extractHeadings, type Heading } from "./markdown";
import { FindBar } from "./FindBar";
import { Sidebar, type FileEntry } from "./Sidebar";
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

const MD_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"];

const WELCOME = `# Markappoly

> **Pass Go, straight to preview.** A fast, cross-platform viewer for **formatted Markdown** — built with Tauri + React.

## What works

- Open any \`.md\` file (or a whole folder) and read it nicely formatted
- Toggle to **Edit** mode (⌘E) — a formatting toolbar appears
- **Export** to TXT, HTML, JSON, Word or PDF
- Math, diagrams, an outline, find (⌘F), live reload, and more

### Math & diagrams

Inline math like $e^{i\\pi} + 1 = 0$ and blocks render via KaTeX.

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview]
  B --> C[Export]
\`\`\`

### GitHub-flavored too

| Feature | Supported |
| ------- | :-------: |
| Tables  | ✅ |
| Task lists | ✅ |
| Code highlighting | ✅ |

- [x] Render Markdown
- [ ] Try ticking this box

> Open a file with ⌘O, or drag one onto the window.
`;

function basename(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? "Untitled";
}

function App() {
  const prefs = usePreferences();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [source, setSource] = useState<string>(WELCOME);
  const [mode, setMode] = useState<Mode>("preview");
  const [dirty, setDirty] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastMtime = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const headings = useMemo(() => extractHeadings(source), [source]);
  const wordCount = useMemo(() => (source.trim().match(/\S+/g) || []).length, [source]);
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  // ----- Open / save -----
  const openPath = useCallback(async (path: string) => {
    try {
      const text = await invoke<string>("read_file", { path });
      setSource(text);
      setFilePath(path);
      setDirty(false);
      setMode("preview");
      try {
        lastMtime.current = await invoke<number>("file_mtime", { path });
      } catch {
        lastMtime.current = null;
      }
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
    if (!filePath) return;
    const text = await invoke<string>("read_file", { path: filePath });
    setSource(text);
    setDirty(false);
    try {
      lastMtime.current = await invoke<number>("file_mtime", { path: filePath });
    } catch {
      /* ignore */
    }
  }, [filePath]);

  const saveFile = useCallback(async () => {
    let path = filePath;
    if (!path) {
      const chosen = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!chosen) return;
      path = chosen;
      setFilePath(path);
    }
    await invoke("write_file", { path, contents: source });
    setDirty(false);
    try {
      lastMtime.current = await invoke<number>("file_mtime", { path });
    } catch {
      /* ignore */
    }
  }, [filePath, source]);

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      if (kind === "pdf") {
        setMode("preview");
        setTimeout(() => window.print(), 60);
        return;
      }
      if (kind === "docx") {
        const name = basename(filePath).replace(/\.[^.]+$/, "") || "document";
        const chosen = await save({
          defaultPath: `${name}.docx`,
          filters: [{ name: "Word Document", extensions: ["docx"] }],
        });
        if (!chosen) return;
        const data = await markdownToDocxBase64(source);
        await invoke("write_file_base64", { path: chosen, data });
        return;
      }

      const base = basename(filePath).replace(/\.[^.]+$/, "") || "document";
      let contents: string;
      if (kind === "txt") contents = source;
      else if (kind === "html")
        contents = htmlDocument(basename(filePath), markdownToHtml(source));
      else contents = JSON.stringify(markdownToAst(source), null, 2);

      const chosen = await save({
        defaultPath: `${base}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!chosen) return;
      await invoke("write_file", { path: chosen, contents });
    },
    [filePath, source],
  );

  // ----- Formatting (operate on the CodeMirror selection) -----
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
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    const changes: { from: number; insert: string }[] = [];
    for (let n = first; n <= last; n++) {
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
      let i = -1;
      const re = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm;
      const updated = source.replace(re, (full, prefix, c) => {
        i += 1;
        if (i !== index) return full;
        return prefix + (c === " " ? "[x]" : "[ ]");
      });
      if (updated !== source) {
        setSource(updated);
        setDirty(true);
      }
    },
    [source],
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

  // ----- Live reload: poll mtime, refresh when unchanged locally -----
  useEffect(() => {
    if (!filePath) return;
    const id = setInterval(async () => {
      if (dirtyRef.current) return;
      try {
        const m = await invoke<number>("file_mtime", { path: filePath });
        if (lastMtime.current != null && m !== lastMtime.current) {
          lastMtime.current = m;
          const text = await invoke<string>("read_file", { path: filePath });
          setSource(text);
          setDirty(false);
        }
      } catch {
        /* file may be mid-write or removed */
      }
    }, 1200);
    return () => clearInterval(id);
  }, [filePath]);

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

  // Menu clicks/accelerators and macOS "open with" arrive as events.
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

  // Open a file passed on the command line (Windows/Linux "open with").
  useEffect(() => {
    invoke<string | null>("cli_file_arg")
      .then((p) => {
        if (p) openPath(p);
      })
      .catch(() => {});
  }, [openPath]);

  // Check for updates on launch (silently no-ops without a reachable endpoint).
  useEffect(() => {
    check()
      .then((update) => {
        if (update) console.info(`Update available: ${update.version}`);
      })
      .catch(() => {});
  }, []);

  // ----- Keyboard shortcuts (chords not owned by the native menu) -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      switch (key) {
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
    reloadFile,
    mode,
    prefs.toggleSidebar,
    prefs.zoomIn,
    prefs.zoomOut,
    prefs.zoomReset,
    wrapSelection,
    insertLink,
  ]);

  return (
    <div className="app">
      <header className="toolbar">
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
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
            Preview
          </button>
          <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
            Edit
          </button>
        </div>

        <div className="spacer" />

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
          <button
            className="icon-btn zoom-label"
            onClick={prefs.zoomReset}
            title="Reset zoom (⌘0)"
          >
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
          {mode === "edit" && (
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
          )}

          {findOpen && mode === "preview" && (
            <FindBar container={contentRef.current} onClose={() => setFindOpen(false)} />
          )}

          <main className="content" ref={contentRef}>
            {mode === "preview" ? (
              <div className="markdown-body">
                <Preview source={source} dark={prefs.dark} onToggleTask={toggleTask} />
              </div>
            ) : (
              <CodeMirror
                ref={cmRef}
                className="editor"
                value={source}
                height="100%"
                theme={prefs.dark ? "dark" : "light"}
                extensions={[markdown(), search()]}
                onChange={(value) => {
                  setSource(value);
                  setDirty(true);
                }}
              />
            )}
          </main>

          <footer className="status-bar">
            <span>
              {basename(filePath)}
              {dirty ? " •" : ""}
            </span>
            <span>
              {wordCount} words · {readMin} min read{mode === "edit" ? " · Edit" : ""}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
