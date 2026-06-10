import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Source-editor chrome driven by the app's own CSS variables, so the editor
 * always matches the current light or dark reading surface. The built-in
 * CodeMirror themes hard-code their colors: the dark one (oneDark) paints
 * light-gray text, which became invisible once it landed on the light reading
 * surface. Deriving everything from `--text` and friends keeps text legible in
 * both modes and makes the editor feel like part of the app.
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
    lineHeight: "1.7",
  },
  ".cm-content": {
    padding: "20px 0 80px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0 18px",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 16px",
  },
  ".cm-activeLine": { backgroundColor: "var(--code-bg)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--code-bg)",
    color: "var(--text)",
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
