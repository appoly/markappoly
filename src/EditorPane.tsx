import { useEffect, useMemo, useRef, useCallback } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
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
import { Preview } from "./markdown";
import { useDebouncedValue } from "./useDebouncedValue";
import { restoreEditor, type EditorSession } from "./editorSession";
import { isInTable } from "./tableTools";
import type { FileEntry } from "./Sidebar";

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
}: EditorProps) {
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
    () => wikiCompletion(getFiles, getTags),
    [getFiles, getTags],
  );

  const extensions = useMemo(() => {
    const ext: Extension[] = [
      markdown(),
      search(),
      ...EDITOR_BASE,
      imageExt,
      wikiExt,
      sessionExt,
    ];
    if (features.pasteAsMarkdown) ext.push(pasteMarkdown);
    if (features.spellcheck) ext.push(spellcheck);
    if (features.focusMode) ext.push(focusMode);
    if (features.typewriter) ext.push(typewriter);
    return ext;
  }, [
    imageExt,
    wikiExt,
    sessionExt,
    features.pasteAsMarkdown,
    features.spellcheck,
    features.focusMode,
    features.typewriter,
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
  ...editor
}: EditorProps & {
  dark: boolean;
  basePath?: string;
  onToggleTask: (i: number) => void;
  onOpenLocal?: (path: string) => void;
  blockRemoteImages?: boolean;
  resolveWiki?: (target: string) => string | null;
  onTagClick?: (tag: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  // Debounce the preview so typing stays snappy on large documents.
  const previewSource = useDebouncedValue(editor.value, 140);

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
        <EditorPane {...editor} />
      </div>
      <div className="split-pane split-preview" ref={previewRef}>
        <div className="markdown-body">
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
