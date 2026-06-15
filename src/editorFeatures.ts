import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { htmlToMarkdown } from "./htmlToMarkdown";

/**
 * Focus mode — dims every line except the paragraph the cursor sits in, so the
 * sentence you're writing stands out. A paragraph is the run of non-blank lines
 * around the cursor.
 */
const dimLine = Decoration.line({ class: "cm-focus-dim" });

export const focusMode: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const { doc } = view.state;
      const cursorLine = doc.lineAt(view.state.selection.main.head).number;
      let start = cursorLine;
      let end = cursorLine;
      while (start > 1 && doc.line(start - 1).text.trim() !== "") start--;
      while (end < doc.lines && doc.line(end + 1).text.trim() !== "") end++;

      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = doc.lineAt(pos);
          if (line.number < start || line.number > end) builder.add(line.from, line.from, dimLine);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Typewriter scrolling — keeps the active line vertically centred. The tall
 * top/bottom padding lets the first and last lines reach the middle too.
 */
export const typewriter: Extension = [
  EditorView.theme({
    ".cm-content": { paddingTop: "42vh", paddingBottom: "42vh" },
  }),
  EditorView.updateListener.of((u) => {
    if (!u.selectionSet && !u.docChanged) return;
    const head = u.state.selection.main.head;
    // Defer the scroll so we don't dispatch synchronously from within an update.
    requestAnimationFrame(() => {
      if (!u.view.dom.isConnected) return;
      u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  }),
];

/** Turn on the platform spellchecker (red squiggles + right-click suggestions). */
export const spellcheck: Extension = EditorView.contentAttributes.of({ spellcheck: "true" });

/**
 * Convert pasted rich text (HTML) to Markdown. Plain-text pastes carry no
 * `text/html`, so they fall through to the default handler; image pastes are
 * left to the image handler (registered before this one).
 */
export const pasteMarkdown: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const cd = event.clipboardData;
    if (!cd) return false;
    const hasImage = Array.from(cd.items).some(
      (i) => i.kind === "file" && i.type.startsWith("image/"),
    );
    if (hasImage) return false;
    const html = cd.getData("text/html");
    if (!html || !html.trim()) return false;
    const md = htmlToMarkdown(html);
    if (!md) return false;
    const { from, to } = view.state.selection.main;
    event.preventDefault();
    view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
    return true;
  },
});
