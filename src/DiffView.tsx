import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

const darkTheme = EditorView.theme(
  {
    "&": { color: "#e6edf3", backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#6b7280",
      border: "none",
    },
  },
  { dark: true },
);

/** Side-by-side diff of two documents using CodeMirror's merge view. */
export function DiffView({ a, b, dark }: { a: string; b: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;
    const common = [
      markdown(),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      ...(dark ? [darkTheme] : []),
    ];
    const view = new MergeView({
      a: { doc: a, extensions: common },
      b: { doc: b, extensions: common },
      parent,
    });
    return () => view.destroy();
  }, [a, b, dark]);

  return <div className="diff-view" ref={ref} />;
}
