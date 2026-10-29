// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { DecorationSet } from "@codemirror/view";
import { blockDecorations, cellHtml, liveDecorations, markdownExtras } from "./livePreview";

const lang = markdown({ base: markdownLanguage, extensions: [markdownExtras] });

function state(doc: string, cursor = doc.length) {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: lang,
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

/** Each decoration as a readable tag: hidden text, widget name, or class. */
function describe_(s: EditorState, set: DecorationSet) {
  const out: string[] = [];
  set.between(0, s.doc.length, (from, to, deco) => {
    const widget = deco.spec.widget?.constructor.name;
    const text = JSON.stringify(s.sliceDoc(from, to));
    if (widget) out.push(`${widget} ${text}`);
    else if (deco.spec.class) out.push(`${deco.spec.class}@${s.doc.lineAt(from).number}${from < to ? ` ${text}` : ""}`);
    else out.push(`hide ${text}`);
  });
  return out;
}
const live = (doc: string, cursor?: number) => {
  const s = state(doc, cursor);
  return describe_(s, liveDecorations(s, [{ from: 0, to: s.doc.length }]));
};
const hidden = (doc: string, cursor?: number) =>
  live(doc, cursor).filter((d) => d.startsWith("hide")).map((d) => d.slice(5));

describe("live formatting", () => {
  it("hides heading marks off the cursor line and keeps the heading size", () => {
    const doc = "# Title\n\ntext";
    expect(live(doc)).toEqual(["cm-lp-h1@1", 'hide "# "']);
    expect(live(doc, 2)).toEqual(["cm-lp-h1@1"]);
  });

  it("hides emphasis, strikethrough and code markers", () => {
    const doc = "a **b** _c_ ~~d~~ `e`\n";
    expect(hidden(doc)).toEqual(['"**"', '"**"', '"_"', '"_"', '"~~"', '"~~"', '"`"', '"`"']);
    expect(hidden(doc, 0)).toEqual([]);
  });

  it("reveals markup on every line a selection spans", () => {
    const s = EditorState.create({
      doc: "**a**\n**b**\n**c**",
      selection: EditorSelection.range(2, 8),
      extensions: lang,
    });
    ensureSyntaxTree(s, s.doc.length, 5000);
    const deco = describe_(s, liveDecorations(s, [{ from: 0, to: s.doc.length }]));
    // Lines 1 and 2 are selected; only line 3's markers hide.
    expect(deco).toEqual(['hide "**"', 'hide "**"']);
  });

  it("shows a link as its text with the URL hidden", () => {
    const doc = "see [docs](https://x.dev \"t\") now\n";
    expect(hidden(doc)).toEqual(['"["', '"](https://x.dev \\"t\\")"']);
    expect(live(doc)).toContain('cm-lp-link@1 "docs"');
  });

  it("draws bullets, task boxes and done items", () => {
    const deco = live("- one\n- [x] two\n- [ ] three\n\nend");
    expect(deco).toContain('BulletWidget "-"');
    expect(deco).toContain('hide "- "');
    expect(deco.filter((d) => d.startsWith("CheckboxWidget"))).toEqual([
      'CheckboxWidget "[x]"',
      'CheckboxWidget "[ ]"',
    ]);
    expect(deco).toContain('cm-lp-done@2 " two"');
  });

  it("styles quotes and replaces rules", () => {
    const deco = live("> quoted\n\n---\n\nend");
    expect(deco).toEqual(["cm-lp-quote@1", 'hide "> "', 'RuleWidget "---"']);
  });

  it("leaves fenced code untouched apart from its background", () => {
    const deco = live("```js\nlet **a** = 1\n```\n\nend");
    expect(deco).toEqual([
      "cm-lp-codeblock cm-lp-codeblock-first@1",
      "cm-lp-codeblock@2",
      "cm-lp-codeblock cm-lp-codeblock-last@3",
    ]);
  });

  it("renders inline math unless the cursor is on it", () => {
    const doc = "Energy $E=mc^2$ and $$x$$\n\nend";
    expect(live(doc).filter((d) => d.startsWith("Math"))).toEqual([
      'MathWidget "$E=mc^2$"',
      'MathWidget "$$x$$"',
    ]);
    expect(live(doc, 3)).toEqual([]);
  });

  it("does not take an escaped or unclosed dollar as math", () => {
    expect(live("costs \\$5 and $ more\n\nend")).toEqual([]);
  });

  it("parses frontmatter instead of a rule and a heading", () => {
    const deco = live("---\ntitle: x\n---\n\nbody");
    expect(deco).toEqual([
      "cm-lp-frontmatter cm-lp-frontmatter-first@1",
      "cm-lp-frontmatter@2",
      "cm-lp-frontmatter cm-lp-frontmatter-last@3",
    ]);
  });

  it("only decorates the requested ranges", () => {
    const doc = "# A\n\n# B\n\n# C\n\nend";
    const s = state(doc);
    const line3 = s.doc.line(3);
    expect(describe_(s, liveDecorations(s, [{ from: line3.from, to: line3.to }]))).toEqual([
      "cm-lp-h1@3",
      'hide "# "',
    ]);
  });
});

describe("live formatting blocks", () => {
  const doc = "| a | b |\n| - | -: |\n| 1 | **2** |\n\n$$\nx^2\n$$\n\nend";
  const blocks = (cursor: number) => {
    const s = state(doc, cursor);
    return describe_(s, blockDecorations(s));
  };

  it("renders tables and math blocks away from the selection", () => {
    expect(blocks(doc.length)).toEqual([
      `TableWidget ${JSON.stringify(doc.slice(0, doc.indexOf("\n\n")))}`,
      'MathWidget "$$\\nx^2\\n$$"',
    ]);
  });

  it("shows the raw table while the cursor is in it", () => {
    expect(blocks(3)).toEqual(['MathWidget "$$\\nx^2\\n$$"']);
    const s = state(doc, 3);
    expect(describe_(s, liveDecorations(s, [{ from: 0, to: 20 }]))[0]).toBe(
      "cm-lp-table-src cm-lp-table-src-first@1",
    );
  });

  it("leaves an unclosed math block as source", () => {
    const s = state("$$\nx\n\nmore", 0);
    expect(describe_(s, blockDecorations(s))).toEqual([]);
  });

  it("formats table cells", () => {
    expect(cellHtml("**b** `<c>` [l](u)")).toBe(
      '<strong>b</strong> <code>&lt;c&gt;</code> <span class="cm-lp-link">l</span>',
    );
  });
});
