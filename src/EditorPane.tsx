import { useEffect, useRef } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { editorTheme, editorHighlight } from "./editorTheme";
import { Preview } from "./markdown";
import { useDebouncedValue } from "./useDebouncedValue";

const EDITOR_BASE: Extension[] = [editorTheme, editorHighlight, EditorView.lineWrapping];

/** The CodeMirror source editor, shared by the Edit and Split views. */
export function EditorPane({
  docId,
  value,
  cmRef,
  extra,
  onChange,
}: {
  docId: string;
  value: string;
  cmRef: React.RefObject<ReactCodeMirrorRef | null>;
  extra: Extension[];
  onChange: (v: string) => void;
}) {
  return (
    <CodeMirror
      key={docId}
      ref={cmRef}
      className="editor"
      value={value}
      height="100%"
      theme="none"
      basicSetup={{ foldGutter: false, syntaxHighlighting: false }}
      extensions={[markdown(), search(), ...EDITOR_BASE, ...extra]}
      onChange={onChange}
      onCreateEditor={(view) => {
        // WKWebView can lay the gutter out before the container has its final
        // size, stacking line numbers above the text. Re-measure once layout
        // has settled so the gutter sits beside the content.
        requestAnimationFrame(() => view.requestMeasure());
        setTimeout(() => view.requestMeasure(), 60);
      }}
    />
  );
}

/** Editor and live preview side by side, with linked scrolling. */
export function SplitView({
  docId,
  value,
  cmRef,
  extra,
  onChange,
  dark,
  basePath,
  onToggleTask,
  onOpenLocal,
  blockRemoteImages,
}: {
  docId: string;
  value: string;
  cmRef: React.RefObject<ReactCodeMirrorRef | null>;
  extra: Extension[];
  onChange: (v: string) => void;
  dark: boolean;
  basePath?: string;
  onToggleTask: (i: number) => void;
  onOpenLocal?: (path: string) => void;
  blockRemoteImages?: boolean;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  // Debounce the preview so typing stays snappy on large documents.
  const previewSource = useDebouncedValue(value, 140);

  useEffect(() => {
    const scroller = cmRef.current?.view?.scrollDOM;
    const preview = previewRef.current;
    if (!scroller || !preview) return;
    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (lock.current) return;
      lock.current = true;
      const max = Math.max(1, from.scrollHeight - from.clientHeight);
      to.scrollTop = (from.scrollTop / max) * (to.scrollHeight - to.clientHeight);
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
  }, [cmRef, docId]);

  return (
    <div className="split">
      <div className="split-pane split-editor">
        <EditorPane docId={docId} value={value} cmRef={cmRef} extra={extra} onChange={onChange} />
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
          />
        </div>
      </div>
    </div>
  );
}
