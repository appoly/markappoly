import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { extractHeadings, type Heading, Preview } from "./markdown";
import { FindBar } from "./FindBar";
import { Sidebar, type FileEntry } from "./Sidebar";
import { TabBar } from "./TabBar";
import { DiffView } from "./DiffView";
import { PresentView } from "./PresentView";
import { usePreferences } from "./prefs";
import { Settings } from "./Settings";
import { focusMode, typewriter, spellcheck, pasteMarkdown } from "./editorFeatures";
import { insertTable, addRow, addColumn, formatTable } from "./tableTools";
import { Menu, type MenuEntry } from "./Menu";
import {
  SidebarIcon,
  OpenIcon,
  SaveIcon,
  ReloadIcon,
  PresentIcon,
  MinusIcon,
  PlusIcon,
  ExportIcon,
  MoreIcon,
  ChevronIcon,
} from "./icons";
import {
  markdownToHtml,
  markdownToAst,
  htmlDocument,
  markdownToDocxBase64,
} from "./export";
import { EditorPane, SplitView } from "./EditorPane";
import { FrontmatterBar } from "./FrontmatterBar";
import { useLiveReload } from "./useLiveReload";
import { useScrollSpy } from "./useScrollSpy";
import { loadSession, saveSession } from "./session";
import { basename, dirOf, MD_EXTENSIONS } from "./paths";
import { makeDoc, type Doc, type ExportKind, type Mode } from "./types";
import { WELCOME } from "./welcome";
import "./App.css";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const PANDOC_FORMATS = [
  { ext: "docx", label: "Word via Pandoc (.docx)" },
  { ext: "pdf", label: "PDF via Pandoc (.pdf)" },
  { ext: "rtf", label: "Rich Text (.rtf)" },
  { ext: "epub", label: "EPUB (.epub)" },
  { ext: "tex", label: "LaTeX (.tex)" },
];

function docName(d: Doc): string {
  return d.path ? basename(d.path) : "Untitled";
}

function App() {
  const prefs = usePreferences();
  const session = useRef(loadSession());
  const first = useRef<Doc | null>(null);
  if (first.current === null) first.current = makeDoc({ source: WELCOME });

  const [docs, setDocs] = useState<Doc[]>(() => [first.current!]);
  const [activeId, setActiveId] = useState<string>(() => first.current!.id);
  const [mode, setMode] = useState<Mode>(session.current.mode);
  const [compare, setCompare] = useState<{ aId: string; bId: string } | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(session.current.folderPath);
  const [findOpen, setFindOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pandocOk, setPandocOk] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const docsRef = useRef(docs);
  docsRef.current = docs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);

  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  const source = active.source;
  const dirty = active.dirty;
  const filePath = active.path;
  const baseDir = useMemo(() => dirOf(filePath), [filePath]);

  const headings = useMemo(() => extractHeadings(source), [source]);
  const wordCount = useMemo(() => (source.trim().match(/\S+/g) || []).length, [source]);
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  const activeHeadingSlug = useScrollSpy(
    contentEl,
    [source, mode, active.id],
    mode === "preview" && !compare,
  );

  const getActive = useCallback(
    () => docsRef.current.find((d) => d.id === activeIdRef.current) ?? docsRef.current[0],
    [],
  );
  const patchDocById = useCallback((id: string, patch: Partial<Doc>) => {
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  useLiveReload(docs, patchDocById, docsRef);

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

  const closeTab = useCallback(async (id: string) => {
    const cur = docsRef.current;
    const doc = cur.find((d) => d.id === id);
    if (!doc) return;
    if (doc.dirty) {
      const discard = await ask(`Discard unsaved changes to ${docName(doc)}?`, {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Discard",
        cancelLabel: "Cancel",
      });
      if (!discard) return;
    }
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
      setDocs((ds) => {
        const onlyWelcome =
          ds.length === 1 && ds[0].path === null && !ds[0].dirty && ds[0].source === WELCOME;
        return onlyWelcome ? [doc] : [...ds, doc];
      });
      setActiveId(doc.id);
      setCompare(null);
      setMode("preview");
      invoke("push_recent", { path }).catch(() => {});
    } catch (e) {
      console.error("open failed", e);
    }
  }, []);

  const openPathAtLine = useCallback(
    async (path: string, line: number) => {
      await openPath(path);
      setMode("edit");
      setTimeout(() => {
        const view = cmRef.current?.view;
        if (!view) return;
        const n = Math.min(Math.max(1, line), view.state.doc.lines);
        const pos = view.state.doc.line(n).from;
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      }, 140);
    },
    [openPath],
  );

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: MD_EXTENSIONS }],
    });
    if (typeof selected === "string") openPath(selected);
  }, [openPath]);

  const loadFolder = useCallback(async (dir: string) => {
    setFolderPath(dir);
    try {
      setFiles(await invoke<FileEntry[]>("list_markdown_dir", { path: dir }));
    } catch (e) {
      console.error(e);
      setFiles([]);
    }
  }, []);

  const openFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await loadFolder(dir);
  }, [loadFolder]);

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
    invoke("push_recent", { path }).catch(() => {});
  }, [getActive, patchDocById]);

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      const doc = getActive();
      const src = doc.source;
      const name = basename(doc.path).replace(/\.[^.]+$/, "") || "document";

      if (kind === "pdf") {
        setCompare(null);
        setMode("preview");
        // Let the preview paint, then print with print-only CSS (page breaks on hr).
        setTimeout(() => window.print(), 80);
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

  const exportPandoc = useCallback(
    async (ext: string) => {
      const doc = getActive();
      const name = basename(doc.path).replace(/\.[^.]+$/, "") || "document";
      const chosen = await save({
        defaultPath: `${name}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!chosen) return;
      try {
        await invoke("export_pandoc", { src: doc.source, outPath: chosen });
      } catch (e) {
        await message(`Pandoc could not produce that file.\n\n${e}`, {
          title: "Export failed",
          kind: "error",
        });
      }
    },
    [getActive],
  );

  const copyAsHtml = useCallback(async () => {
    const html = markdownToHtml(getActive().source);
    try {
      if (navigator.clipboard && "write" in navigator.clipboard) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([html], { type: "text/plain" }),
          }),
        ]);
        return;
      }
    } catch {
      /* fall through */
    }
    const holder = document.createElement("div");
    holder.innerHTML = html;
    holder.setAttribute("contenteditable", "true");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    try {
      document.execCommand("copy");
    } catch {
      /* clipboard unavailable */
    }
    sel?.removeAllRanges();
    document.body.removeChild(holder);
  }, [getActive]);

  // ----- Image attachments -----
  const attachImage = useCallback(
    async (
      view: EditorView,
      payload: { kind: "data"; data: string; ext: string } | { kind: "file"; source: string },
    ) => {
      const doc = getActive();
      if (!doc.path) {
        await message("Save the document first so images can be stored alongside it.", {
          title: "Attach image",
          kind: "warning",
        });
        return;
      }
      try {
        const rel =
          payload.kind === "data"
            ? await invoke<string>("save_image", {
                docPath: doc.path,
                data: payload.data,
                ext: payload.ext,
              })
            : await invoke<string>("attach_image_file", {
                docPath: doc.path,
                source: payload.source,
              });
        const { from, to } = view.state.selection.main;
        const snippet = `![](${rel})`;
        view.dispatch({ changes: { from, to, insert: snippet }, selection: { anchor: from + 2 } });
        view.focus();
      } catch (e) {
        console.error("attach image failed", e);
      }
    },
    [getActive],
  );

  const editorImageExt = useMemo(
    () =>
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            if (it.kind === "file" && it.type.startsWith("image/")) {
              const file = it.getAsFile();
              if (!file) continue;
              event.preventDefault();
              const ext = it.type.split("/")[1] || "png";
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result);
                const base64 = result.split(",")[1] ?? "";
                attachImage(view, { kind: "data", data: base64, ext });
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
          return false;
        },
      }),
    [attachImage],
  );
  const editorExtras = useMemo(() => {
    const ext: Extension[] = [editorImageExt];
    if (prefs.pasteAsMarkdown) ext.push(pasteMarkdown);
    if (prefs.spellcheck) ext.push(spellcheck);
    if (prefs.focusMode) ext.push(focusMode);
    if (prefs.typewriter) ext.push(typewriter);
    return ext;
  }, [
    editorImageExt,
    prefs.pasteAsMarkdown,
    prefs.spellcheck,
    prefs.focusMode,
    prefs.typewriter,
  ]);

  const runOnEditor = useCallback((fn: (view: EditorView) => void) => {
    const view = cmRef.current?.view;
    if (view) fn(view);
  }, []);

  const startCompare = useCallback(() => {
    const cur = docsRef.current;
    if (cur.length < 2) return;
    const a = activeIdRef.current;
    const b = (cur.find((d) => d.id !== a) ?? cur[0]).id;
    setCompare({ aId: a, bId: b });
  }, []);

  const wrapSelection = useCallback((before: string, after = before, placeholder = "") => {
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
  }, []);

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

  const gotoHeading = useCallback(
    (h: Heading) => {
      if (mode === "edit" || mode === "split") {
        const view = cmRef.current?.view;
        if (view) {
          const n = Math.min(h.line + 1, view.state.doc.lines);
          const line = view.state.doc.line(n);
          view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          view.focus();
        }
      } else {
        document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [mode],
  );

  // ----- Session restore (once) -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = session.current;
      // Restore folder first so the sidebar is ready.
      if (s.folderPath) {
        const isDir = await invoke<boolean>("path_is_dir", { path: s.folderPath }).catch(
          () => false,
        );
        if (isDir) await loadFolder(s.folderPath);
        else setFolderPath(null);
      }

      const validPaths: string[] = [];
      for (const p of s.paths) {
        const ok = await invoke<boolean>("path_exists", { path: p }).catch(() => false);
        if (ok) validPaths.push(p);
      }

      if (cancelled) return;

      if (validPaths.length > 0) {
        // Open without replacing mid-loop; openPath de-dupes and swaps welcome on first.
        for (const p of validPaths) {
          await openPath(p);
        }
        if (s.activePath && validPaths.includes(s.activePath)) {
          // openPath already set active to the last opened; re-select preferred.
          const match = docsRef.current.find((d) => d.path === s.activePath);
          if (match) setActiveId(match.id);
        }
        setMode(s.mode);
      }
      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Persist session -----
  useEffect(() => {
    if (!sessionReady) return;
    const paths = docs.map((d) => d.path).filter((p): p is string => !!p);
    const activeDoc = docs.find((d) => d.id === activeId);
    saveSession({
      version: 1,
      paths,
      activePath: activeDoc?.path ?? null,
      mode,
      folderPath,
    });
  }, [docs, activeId, mode, folderPath, sessionReady]);

  // ----- Quit guard for dirty docs -----
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        const dirtyDocs = docsRef.current.filter((d) => d.dirty);
        if (dirtyDocs.length === 0) return;
        event.preventDefault();
        const names = dirtyDocs.map(docName).join(", ");
        const ok = await ask(
          `You have unsaved changes in ${names}. Quit without saving?`,
          {
            title: "Unsaved changes",
            kind: "warning",
            okLabel: "Quit",
            cancelLabel: "Cancel",
          },
        );
        if (ok) {
          // Mark clean so a second close isn't blocked, then destroy.
          setDocs((ds) => ds.map((d) => (d.dirty ? { ...d, dirty: false } : d)));
          await getCurrentWindow().destroy();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // ----- Drag a file onto the window -----
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const p = event.payload.paths?.[0];
        if (!p) return;
        const view = cmRef.current?.view;
        const editing = modeRef.current === "edit" || modeRef.current === "split";
        if (IMAGE_EXT.test(p) && editing && view && getActive().path) {
          attachImage(view, { kind: "file", source: p });
        } else {
          openPath(p);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [openPath, attachImage, getActive]);

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
        case "toggle_split":
          setCompare(null);
          setMode((m) => (m === "split" ? "preview" : "split"));
          break;
        case "present":
          setCompare(null);
          setPresenting(true);
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "copy_html":
          copyAsHtml();
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
          else if (id.startsWith("recent::")) {
            const rest = id.slice("recent::".length);
            if (rest === "clear") invoke("clear_recents").catch(() => {});
            else if (rest !== "none") openPath(rest);
          }
      }
    },
    [
      openFile,
      openFolder,
      saveFile,
      reloadFile,
      mode,
      copyAsHtml,
      openPath,
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
    invoke<string[]>("take_pending_open")
      .then((paths) => paths.forEach((p) => openPath(p)))
      .catch(() => {});
  }, [openPath]);

  useEffect(() => {
    invoke<boolean>("pandoc_available").then(setPandocOk).catch(() => {});
  }, []);

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

  // ----- Keyboard shortcuts -----
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
        case ",":
          e.preventDefault();
          setSettingsOpen((o) => !o);
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
          if (mode === "edit" || mode === "split") {
            e.preventDefault();
            wrapSelection("**", "**", "bold");
          }
          break;
        case "i":
          if (mode === "edit" || mode === "split") {
            e.preventDefault();
            wrapSelection("*", "*", "italic");
          }
          break;
        case "k":
          if (mode === "edit" || mode === "split") {
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
  const editing = mode === "edit" || mode === "split";

  const exportItems: MenuEntry[] = [
    { type: "item", label: "Text (.txt)", onSelect: () => exportAs("txt") },
    { type: "item", label: "HTML (.html)", onSelect: () => exportAs("html") },
    { type: "item", label: "JSON AST (.json)", onSelect: () => exportAs("json") },
    { type: "item", label: "Word (.docx)", onSelect: () => exportAs("docx") },
    { type: "item", label: "PDF (print)", onSelect: () => exportAs("pdf") },
    ...(pandocOk
      ? [
          { type: "header", label: "Via Pandoc" } as MenuEntry,
          ...PANDOC_FORMATS.map(
            (f): MenuEntry => ({
              type: "item",
              label: f.label,
              onSelect: () => exportPandoc(f.ext),
            }),
          ),
        ]
      : []),
  ];

  const overflowItems: MenuEntry[] = [
    { type: "item", label: "Settings…", onSelect: () => setSettingsOpen(true) },
    {
      type: "item",
      label: "Compare two files…",
      onSelect: startCompare,
      disabled: docs.length < 2,
    },
    { type: "separator" },
    { type: "header", label: "Theme" },
    {
      type: "item",
      label: "System",
      onSelect: () => prefs.setTheme("system"),
      checked: prefs.theme === "system",
    },
    {
      type: "item",
      label: "Light",
      onSelect: () => prefs.setTheme("light"),
      checked: prefs.theme === "light",
    },
    {
      type: "item",
      label: "Dark",
      onSelect: () => prefs.setTheme("dark"),
      checked: prefs.theme === "dark",
    },
  ];

  return (
    <div className="app">
      <header className="toolbar" data-tauri-drag-region>
        <div className="toolbar-group">
          <button className="icon-btn" onClick={prefs.toggleSidebar} title="Toggle sidebar (⌘\)">
            <SidebarIcon />
          </button>
          <button className="icon-btn" onClick={openFile} title="Open (⌘O)">
            <OpenIcon />
          </button>
          <button
            className="icon-btn"
            onClick={saveFile}
            title="Save (⌘S)"
            disabled={!dirty && !!filePath}
          >
            <SaveIcon />
          </button>
          <button className="icon-btn" onClick={reloadFile} title="Reload (⌘R)" disabled={!filePath}>
            <ReloadIcon />
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
            className={!compare && mode === "split" ? "active" : ""}
            onClick={() => {
              setCompare(null);
              setMode("split");
            }}
            title="Split editor and preview (⌘⇧E)"
          >
            Split
          </button>
        </div>

        <div className="spacer" data-tauri-drag-region />

        <div className="toolbar-group">
          <button className="icon-btn" onClick={() => setPresenting(true)} title="Present (⌘⇧P)">
            <PresentIcon />
          </button>

          <div className="zoom-pill">
            <button className="icon-btn" onClick={prefs.zoomOut} title="Zoom out (⌘-)">
              <MinusIcon />
            </button>
            <button className="zoom-label" onClick={prefs.zoomReset} title="Reset zoom (⌘0)">
              {Math.round(prefs.zoom * 100)}%
            </button>
            <button className="icon-btn" onClick={prefs.zoomIn} title="Zoom in (⌘+)">
              <PlusIcon />
            </button>
          </div>

          <Menu
            className="icon-btn menu-trigger"
            title="Export…"
            align="right"
            label={
              <>
                <ExportIcon />
                <ChevronIcon />
              </>
            }
            items={exportItems}
          />

          <Menu
            className="icon-btn menu-trigger"
            title="More"
            align="right"
            label={<MoreIcon />}
            items={overflowItems}
          />
        </div>
      </header>

      <div className="body">
        {prefs.sidebarOpen && (
          <Sidebar
            files={files}
            folderName={folderPath ? basename(folderPath) : null}
            folderPath={folderPath}
            activePath={filePath}
            onOpenFile={openPath}
            onOpenFolder={openFolder}
            onOpenAtLine={openPathAtLine}
            headings={headings}
            onGotoHeading={gotoHeading}
            activeHeadingSlug={activeHeadingSlug}
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
            editing && (
              <div className="format-bar">
                <button
                  className="fmt fmt-b"
                  title="Bold (⌘B)"
                  onClick={() => wrapSelection("**", "**", "bold")}
                >
                  B
                </button>
                <button
                  className="fmt fmt-i"
                  title="Italic (⌘I)"
                  onClick={() => wrapSelection("*", "*", "italic")}
                >
                  I
                </button>
                <button
                  className="fmt fmt-s"
                  title="Strikethrough"
                  onClick={() => wrapSelection("~~", "~~", "text")}
                >
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
                <button
                  className="fmt"
                  title="Inline code"
                  onClick={() => wrapSelection("`", "`", "code")}
                >
                  {"</>"}
                </button>
                <button className="fmt" title="Code block" onClick={insertCodeBlock}>
                  {"{ }"} Block
                </button>
                <button className="fmt" title="Link (⌘K)" onClick={insertLink}>
                  🔗 Link
                </button>
                <span className="sep" />
                <button className="fmt" title="Insert table" onClick={() => runOnEditor(insertTable)}>
                  ⊞ Table
                </button>
                <button className="fmt" title="Add row to table" onClick={() => runOnEditor(addRow)}>
                  + Row
                </button>
                <button
                  className="fmt"
                  title="Add column to table"
                  onClick={() => runOnEditor(addColumn)}
                >
                  + Col
                </button>
                <button
                  className="fmt"
                  title="Align table columns"
                  onClick={() => runOnEditor(formatTable)}
                >
                  ↹ Align
                </button>
              </div>
            )
          )}

          {findOpen && !compare && mode === "preview" && (
            <FindBar container={contentRef.current} onClose={() => setFindOpen(false)} />
          )}

          <main
            className="content"
            ref={(el) => {
              contentRef.current = el;
              setContentEl(el);
            }}
          >
            {compare ? (
              <DiffView a={docA?.source ?? ""} b={docB?.source ?? ""} dark={prefs.dark} />
            ) : mode === "preview" ? (
              <div className="markdown-body">
                <FrontmatterBar source={source} />
                <Preview
                  source={source}
                  dark={prefs.dark}
                  basePath={baseDir}
                  onToggleTask={toggleTask}
                  onOpenLocal={openPath}
                  blockRemoteImages={prefs.blockRemoteImages}
                />
              </div>
            ) : mode === "split" ? (
              <SplitView
                docId={active.id}
                value={source}
                cmRef={cmRef}
                extra={editorExtras}
                onChange={(value) => patchDocById(active.id, { source: value, dirty: true })}
                dark={prefs.dark}
                basePath={baseDir}
                onToggleTask={toggleTask}
                onOpenLocal={openPath}
                blockRemoteImages={prefs.blockRemoteImages}
              />
            ) : (
              <EditorPane
                docId={active.id}
                value={source}
                cmRef={cmRef}
                extra={editorExtras}
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
              {compare
                ? " · Compare"
                : mode === "edit"
                  ? " · Edit"
                  : mode === "split"
                    ? " · Split"
                    : ""}
            </span>
          </footer>
        </div>
      </div>

      {presenting && (
        <PresentView
          source={source}
          dark={prefs.dark}
          basePath={baseDir}
          onClose={() => setPresenting(false)}
          blockRemoteImages={prefs.blockRemoteImages}
          onOpenLocal={openPath}
        />
      )}

      {settingsOpen && <Settings prefs={prefs} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
