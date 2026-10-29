import { useEffect, useMemo, useRef, useCallback } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { editorTheme, editorHighlight } from "./editorTheme";
import {
  focusMode,
  typewriter,
  spellcheck,
  pasteMarkdown,
} from "./editorFeatures";
import { wikiCompletion } from "./wikiComplete";
import { slashSource } from "./slashMenu";
import { livePreview, markdownExtras } from "./livePreview";
import { Preview } from "./markdown";
import { useDebouncedValue } from "./useDebouncedValue";
import { restoreEditor, type EditorSession } from "./editorSession";
import { isInTable } from "./tableTools";
import { reviewMarks, showReviewMarks, type LineMark } from "./editorReview";
import type { FileEntry } from "./Sidebar";

// GFM (tables, task lists, strikethrough) plus math and frontmatter, so the
// syntax tree matches what the preview renders.
const MARKDOWN = markdown({ base: markdownLanguage, extensions: [markdownExtras] });

const EDITOR_BASE: Extension[] = [
  editorTheme,
  editorHighlight,
  EditorView.lineWrapping,
];

export type AttachPayload =
  | { kind: "data"; data: string; ext: string }
  | { kind: "file"; source: string };

/** Preference-driven editor behaviours, assembled into extensions here so the
 * whole CodeMirror stack stays out of the startup bundle. */
export type EditorFeatures = {
  focusMode: boolean;
  typewriter: boolean;
  spellcheck: boolean;
  pasteAsMarkdown: boolean;
  /** Draw formatting over the source (Edit view only; Split has a preview). */
  livePreview: boolean;
};

export type EditorProps = {
  docId: string;
  sessions: Map<string, EditorSession>;
  onTableChange: (inside: boolean) => void;
  onReady: (view: EditorView) => void;
  value: string;
  cmRef: React.RefObject<ReactCodeMirrorRef | null>;
  onChange: (v: string) => void;
  features: EditorFeatures;
  onAttachImage: (view: EditorView, payload: AttachPayload) => void;
  getFiles: () => FileEntry[];
  getTags: () => string[];
  /** Lines changed since the reader last saw the file (change review). */
  lineMarks?: LineMark[];
};

/** The CodeMirror source editor, shared by the Edit and Split views. */
export function EditorPane({
  docId,
  sessions,
  onTableChange,
  onReady,
  value,
  cmRef,
  onChange,
  features,
  onAttachImage,
  getFiles,
  getTags,
  lineMarks,
}: EditorProps) {
  const marksRef = useRef<LineMark[]>(lineMarks ?? []);
  marksRef.current = lineMarks ?? [];
  useEffect(() => {
    const view = cmRef.current?.view;
    if (view) showReviewMarks(view, lineMarks ?? []);
  }, [lineMarks, cmRef]);
  const initial = useMemo(
    () => restoreEditor(sessions.get(docId), value),
    [docId, sessions],
  );
  const cacheView = useCallback(
    (view: EditorView) => {
      sessions.set(docId, {
        state: view.state,
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      });
    },
    [docId, sessions],
  );
  const sessionExt = useMemo(
    () =>
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          cacheView(view);
        },
      }),
    [cacheView],
  );
  // Pasted images become attachments; registered before pasteMarkdown so image
  // pastes never reach the rich-text handler.
  const imageExt = useMemo(
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
                onAttachImage(view, { kind: "data", data: base64, ext });
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
          return false;
        },
      }),
    [onAttachImage],
  );

  const wikiExt = useMemo(
    () => wikiCompletion(getFiles, getTags, [slashSource]),
    [getFiles, getTags],
  );

  const extensions = useMemo(() => {
    const ext: Extension[] = [
      MARKDOWN,
      search(),
      ...EDITOR_BASE,
      reviewMarks,
      imageExt,
      wikiExt,
      sessionExt,
    ];
    if (features.pasteAsMarkdown) ext.push(pasteMarkdown);
    if (features.spellcheck) ext.push(spellcheck);
    if (features.focusMode) ext.push(focusMode);
    if (features.typewriter) ext.push(typewriter);
    if (features.livePreview) ext.push(livePreview);
    return ext;
  }, [
    imageExt,
    wikiExt,
    sessionExt,
    features.pasteAsMarkdown,
    features.spellcheck,
    features.focusMode,
    features.typewriter,
    features.livePreview,
  ]);

  return (
    <CodeMirror
      key={docId}
      ref={cmRef}
      className="editor"
      value={value}
      initialState={initial}
      onUpdate={(update) => {
        cacheView(update.view);
        onTableChange(
          isInTable(update.state.doc, update.state.selection.main.head),
        );
      }}
      height="100%"
      theme="none"
      basicSetup={{
        // Live formatting reads as a document; line numbers would follow
        // the source lines, not what you see.
        lineNumbers: !features.livePreview,
        highlightActiveLineGutter: !features.livePreview,
        foldGutter: false,
        syntaxHighlighting: false,
        autocompletion: false,
      }}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        const saved = sessions.get(docId);
        requestAnimationFrame(() => {
          view.requestMeasure();
          if (saved) {
            view.scrollDOM.scrollTop = saved.top;
            view.scrollDOM.scrollLeft = saved.left;
          }
          onTableChange(
            isInTable(view.state.doc, view.state.selection.main.head),
          );
          if (marksRef.current.length) showReviewMarks(view, marksRef.current);
          onReady(view);
        });
      }}
    />
  );
}

/** Editor and live preview side by side, with linked scrolling. */
export function SplitView({
  dark,
  basePath,
  onToggleTask,
  onOpenLocal,
  blockRemoteImages,
  resolveWiki,
  onTagClick,
  onPreviewBody,
  ...editor
}: EditorProps & {
  /** Receives the preview's .markdown-body element (review highlights). */
  onPreviewBody?: (el: HTMLElement | null) => void;
  dark: boolean;
  basePath?: string;
  onToggleTask: (line: number) => void;
  onOpenLocal?: (path: string) => void;
  blockRemoteImages?: boolean;
  resolveWiki?: (target: string) => string | null;
  onTagClick?: (tag: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  // The preview re-renders only edited blocks; a short debounce still batches
  // bursts of keystrokes into one update.
  const previewSource = useDebouncedValue(editor.value, 50);
  // The preview beside the source already shows the formatting, so the split
  // editor stays raw Markdown (and its line numbers keep their meaning).
  const features = useMemo(
    () => ({ ...editor.features, livePreview: false }),
    [editor.features],
  );

  useEffect(() => {
    const scroller = editor.cmRef.current?.view?.scrollDOM;
    const preview = previewRef.current;
    if (!scroller || !preview) return;
    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (lock.current) return;
      lock.current = true;
      const max = Math.max(1, from.scrollHeight - from.clientHeight);
      to.scrollTop =
        (from.scrollTop / max) * (to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => {
        lock.current = false;
      });
    };
    const onEditor = () => sync(scroller, preview);
    const onPreview = () => sync(preview, scroller);
    scroller.addEventListener("scroll", onEditor);
    preview.addEventListener("scroll", onPreview);
    return () => {
      scroller.removeEventListener("scroll", onEditor);
      preview.removeEventListener("scroll", onPreview);
    };
  }, [editor.cmRef, editor.docId]);

  return (
    <div className="split">
      <div className="split-pane split-editor">
        <EditorPane {...editor} features={features} />
      </div>
      <div className="split-pane split-preview" ref={previewRef}>
        <div className="markdown-body" ref={onPreviewBody}>
          <Preview
            source={previewSource}
            dark={dark}
            basePath={basePath}
            onToggleTask={onToggleTask}
            onOpenLocal={onOpenLocal}
            blockRemoteImages={blockRemoteImages}
            resolveWiki={resolveWiki}
            onTagClick={onTagClick}
          />
        </div>
      </div>
    </div>
  );
}
