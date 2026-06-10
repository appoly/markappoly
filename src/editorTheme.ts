import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Editor colours driven by the app's CSS variables, so text stays legible in
 * both light and dark (the built-in CodeMirror themes hard-code colours that
 * went invisible on the light reading surface). This theme deliberately sets
 * NO geometry — no height, no line-height, no vertical padding on .cm-content —
 * because those can desync the line-number gutter from the text in WKWebView.
 * Layout is left to CodeMirror's own defaults.
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
  },
  ".cm-content": {
    caretColor: "var(--accent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--code-bg)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--code-bg)",
  },
  ".cm-line": {
    padding: "0 14px",
  },
});

/** Markdown token styling, also from CSS variables so it adapts to the theme. */
export const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, color: "var(--text)", fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--accent)" },
    { tag: t.monospace, color: "var(--hl-string)" },
    { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
    { tag: [t.list, t.processingInstruction], color: "var(--hl-keyword)" },
    { tag: [t.meta, t.contentSeparator], color: "var(--text-muted)" },
    { tag: t.keyword, color: "var(--hl-keyword)" },
    { tag: t.string, color: "var(--hl-string)" },
    { tag: t.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  ]),
);
