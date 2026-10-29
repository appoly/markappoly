import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import katex from "katex";
import "katex/dist/katex.min.css";
import { isSep, splitCells } from "./tableTools";

/**
 * Live formatting for the Edit view (Obsidian-style live preview): headings at
 * heading sizes, emphasis without its markers, links as link text, bullets,
 * clickable task boxes, quotes, rules, math and tables, all drawn over the
 * plain Markdown source. Markup reappears on every line the selection touches,
 * so what you edit is always the real text. The file itself never changes.
 *
 * Inline styling is computed for the visible ranges only (a ViewPlugin);
 * tables and `$$` blocks replace whole lines, which CodeMirror only accepts
 * from a StateField, so those come from a cheap walk of the top-level blocks.
 */

const DOLLAR = 36;
const BACKSLASH = 92;

/**
 * Parser additions for syntax the stock Markdown grammar lacks: `$…$` / `$$…$$`
 * math (matching remark-math, which the preview uses) and YAML frontmatter,
 * which would otherwise parse as a rule plus a setext heading.
 */
export const markdownExtras: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: t.monospace },
    { name: "InlineMathMark", style: t.processingInstruction },
    { name: "BlockMath", block: true, style: t.monospace },
    { name: "BlockMathMark", style: t.processingInstruction },
    { name: "Frontmatter", block: true, style: t.meta },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        let open = pos;
        while (open < cx.end && cx.char(open) === DOLLAR) open++;
        const len = open - pos;
        if (len > 2) return -1;
        // Like a code span: the closing run must be the same length.
        for (let i = open; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === BACKSLASH) {
            i++;
            continue;
          }
          if (ch !== DOLLAR) continue;
          let close = i;
          while (close < cx.end && cx.char(close) === DOLLAR) close++;
          if (close - i === len) {
            if (i === open) return -1;
            return cx.addElement(
              cx.elt("InlineMath", pos, close, [
                cx.elt("InlineMathMark", pos, open),
                cx.elt("InlineMathMark", i, close),
              ]),
            );
          }
          i = close - 1;
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("Frontmatter", 0, cx.prevLineEnd()));
        return true;
      },
    },
    {
      // `$$` on its own line opens a display block, closed by another bare
      // `$$`. One-line `$$x$$` stays inline (and renders in display mode).
      name: "BlockMath",
      before: "FencedCode",
      parse(cx, line) {
        if (cx.depth > 1 || line.indent - line.baseIndent >= 4) return false;
        if (!/^\$\$\s*$/.test(line.text.slice(line.pos))) return false;
        const from = cx.lineStart + line.pos;
        const marks = [cx.elt("BlockMathMark", from, from + 2)];
        while (cx.nextLine()) {
          if (/^\$\$\s*$/.test(line.text.slice(line.pos))) {
            const at = cx.lineStart + line.pos;
            marks.push(cx.elt("BlockMathMark", at, at + 2));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("BlockMath", from, cx.prevLineEnd(), marks));
        return true;
      },
    },
  ],
};

// ---------- Widgets ----------

/** Put the cursor at `offset` inside the widget's source, revealing it. */
function revealOnMouseDown(el: HTMLElement, view: EditorView, offset: number) {
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const pos = view.posAtDOM(el);
    view.dispatch({ selection: { anchor: pos + offset } });
    view.focus();
  });
}

function renderMath(el: HTMLElement, tex: string, displayMode: boolean) {
  try {
    katex.render(tex, el, { displayMode, throwOnError: false });
  } catch {
    el.textContent = tex;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly block: boolean,
    readonly markLen: number,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.block === this.block;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = this.block ? "cm-lp-math cm-lp-math-block" : "cm-lp-math";
    renderMath(el, this.tex, this.display);
    revealOnMouseDown(el, view, this.markLen);
    return el;
  }
  get estimatedHeight() {
    return this.block ? 64 : -1;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-hr";
    return el;
  }
}

/** A task box that flips `[ ]` ↔ `[x]` in the source without moving the cursor. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const mark = view.state.sliceDoc(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(mark)) return;
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: mark[1] === " " ? "x" : " " },
      });
    });
    // The rebuilt widget carries the new state; stop the native toggle.
    box.addEventListener("click", (e) => e.preventDefault());
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal inline Markdown for table cells: code, math, emphasis, links. */
export function cellHtml(text: string): string {
  return text
    .split(/(`[^`]+`|\$[^$]+\$)/)
    .map((part, i) => {
      if (i % 2) {
        if (part.startsWith("`")) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        try {
          return katex.renderToString(part.slice(1, -1), { throwOnError: false });
        } catch {
          return escapeHtml(part);
        }
      }
      return escapeHtml(part)
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
        .replace(/~~(.+?)~~/g, "<del>$1</del>")
        .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?![*\w])/g, "$1<em>$2</em>")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '<span class="cm-lp-link">$1</span>');
    })
    .join("");
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table";
    const lines = this.source.split("\n");
    const sep = lines.findIndex(isSep);
    const align = (sep >= 0 ? splitCells(lines[sep]) : []).map((c) =>
      c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "",
    );
    const cells = (line: string, tag: string) =>
      splitCells(line)
        .map((c, i) => {
          const style = align[i] ? ` style="text-align:${align[i]}"` : "";
          return `<${tag}${style}>${cellHtml(c)}</${tag}>`;
        })
        .join("");
    const head = lines.slice(0, Math.max(sep, 0));
    const body = lines.slice(sep + 1);
    wrap.innerHTML =
      "<table>" +
      (head.length ? `<thead>${head.map((l) => `<tr>${cells(l, "th")}</tr>`).join("")}</thead>` : "") +
      `<tbody>${body.map((l) => `<tr>${cells(l, "td")}</tr>`).join("")}</tbody></table>`;
    revealOnMouseDown(wrap, view, 0);
    return wrap;
  }
  get estimatedHeight() {
    return this.source.split("\n").length * 30;
  }
  ignoreEvent() {
    return true;
  }
}

// ---------- Decoration building ----------

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const codeMark = Decoration.mark({ class: "cm-lp-code" });
const linkMark = Decoration.mark({ class: "cm-lp-link" });
const doneMark = Decoration.mark({ class: "cm-lp-done" });
const lineClass = new Map<string, Decoration>();
const lineDeco = (cls: string) => {
  let deco = lineClass.get(cls);
  if (!deco) lineClass.set(cls, (deco = Decoration.line({ class: cls })));
  return deco;
};

/** Line-aligned ranges touched by the selection; markup in them stays visible. */
function activeRanges(state: EditorState): [number, number][] {
  return state.selection.ranges.map((r) => [
    state.doc.lineAt(r.from).from,
    state.doc.lineAt(r.to).to,
  ]);
}

const touches = (active: [number, number][], from: number, to: number) =>
  active.some(([a, b]) => from <= b && to >= a);

/** Inline and line decorations for the given (visible) ranges. */
export function liveDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const { doc } = state;
  const active = activeRanges(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<string>();
  const add = (deco: Decoration, from: number, to = from) => {
    const key = `${from}:${to}:${deco === hide ? "h" : (deco.spec.class ?? "w")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(deco.range(from, to));
  };
  // Plugin decorations may not hide line breaks; skip anything multi-line.
  const replace = (deco: Decoration, from: number, to: number) => {
    if (from < to && doc.lineAt(from).number === doc.lineAt(to).number) add(deco, from, to);
  };
  const isActive = (n: { from: number; to: number }) => touches(active, n.from, n.to);
  // Hide a mark plus the space that separates it from the text.
  const hideWithSpace = (from: number, to: number) => {
    while (to < doc.length && doc.sliceString(to, to + 1) === " ") to++;
    replace(hide, from, to);
  };

  for (const { from: vFrom, to: vTo } of ranges) {
    const lines = (from: number, to: number, cls: (n: number, first: number, last: number) => string) => {
      const first = doc.lineAt(from).number;
      const last = doc.lineAt(to).number;
      const start = doc.lineAt(Math.max(from, vFrom)).number;
      const end = doc.lineAt(Math.min(to, vTo)).number;
      for (let n = start; n <= end; n++) add(lineDeco(cls(n, first, last)), doc.line(n).from);
    };
    const blockLines = (node: SyntaxNode, base: string) =>
      lines(node.from, node.to, (n, first, last) =>
        `${base}${n === first ? ` ${base}-first` : ""}${n === last ? ` ${base}-last` : ""}`,
      );

    syntaxTree(state).iterate({
      from: vFrom,
      to: vTo,
      enter: (ref) => {
        const name = ref.name;
        const node = ref.node;
        const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
        if (heading) {
          const setext = name.startsWith("Setext");
          const lastText = setext ? doc.lineAt(node.to).number - 1 : doc.lineAt(node.from).number;
          lines(node.from, doc.line(Math.max(lastText, doc.lineAt(node.from).number)).to, () => `cm-lp-h${heading[1]}`);
          return true;
        }
        switch (name) {
          case "HeaderMark": {
            const parent = node.parent;
            if (!parent || !parent.name.startsWith("ATX") || isActive(parent)) return false;
            if (node.from === parent.from) hideWithSpace(node.from, node.to);
            else {
              let from = node.from;
              while (from > parent.from && doc.sliceString(from - 1, from) === " ") from--;
              replace(hide, from, node.to);
            }
            return false;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark":
            if (node.parent && !isActive(node.parent)) replace(hide, node.from, node.to);
            return false;
          case "InlineCode":
            add(codeMark, node.from, node.to);
            return true;
          case "Link": {
            const marks = node.getChildren("LinkMark");
            const target = node.getChild("URL") ?? node.getChild("LinkLabel");
            if (marks.length < 2 || !target) return true;
            add(linkMark, marks[0].to, marks[1].from);
            if (!isActive(node)) {
              replace(hide, node.from, marks[0].to);
              replace(hide, marks[1].from, node.to);
            }
            return true;
          }
          case "Autolink": {
            const url = node.getChild("URL");
            if (url) add(linkMark, url.from, url.to);
            if (url && !isActive(node)) {
              replace(hide, node.from, url.from);
              replace(hide, url.to, node.to);
            }
            return false;
          }
          case "ListMark": {
            if (node.parent?.parent?.name !== "BulletList" || isActive(node)) return false;
            const task = node.parent.getChild("Task")?.getChild("TaskMarker");
            if (task && doc.lineAt(task.from).number === doc.lineAt(node.from).number)
              replace(hide, node.from, task.from);
            else replace(bullet, node.from, node.to);
            return false;
          }
          case "Task": {
            const marker = node.getChild("TaskMarker");
            if (!marker) return false;
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            // Strike the words, not the space after the box.
            const textFrom = marker.to + (doc.sliceString(marker.to, marker.to + 1) === " " ? 1 : 0);
            if (checked && textFrom < node.to) add(doneMark, textFrom, node.to);
            if (!isActive(marker))
              replace(Decoration.replace({ widget: new CheckboxWidget(checked) }), marker.from, marker.to);
            return true;
          }
          case "Blockquote":
            lines(node.from, node.to, () => "cm-lp-quote");
            return true;
          case "QuoteMark":
            if (!isActive(node)) hideWithSpace(node.from, node.to);
            return false;
          case "HorizontalRule":
            if (!isActive(node)) replace(rule, node.from, node.to);
            return false;
          case "FencedCode":
          case "CodeBlock":
            blockLines(node, "cm-lp-codeblock");
            return false;
          case "Table":
            // Rendered by the block field unless the selection is inside.
            if (isActive(node) || node.parent?.name !== "Document") blockLines(node, "cm-lp-table-src");
            return false;
          case "BlockMath":
            if (isActive(node) || node.parent?.name !== "Document") blockLines(node, "cm-lp-codeblock");
            return false;
          case "Frontmatter":
            blockLines(node, "cm-lp-frontmatter");
            return false;
          case "InlineMath": {
            if (isActive(node)) return false;
            const marks = node.getChildren("InlineMathMark");
            if (marks.length < 2) return false;
            const tex = doc.sliceString(marks[0].to, marks[1].from);
            const len = marks[0].to - marks[0].from;
            replace(
              Decoration.replace({ widget: new MathWidget(tex, len === 2, false, len) }),
              node.from,
              node.to,
            );
            return false;
          }
          case "Image":
          case "HTMLBlock":
          case "CommentBlock":
            return false;
        }
        return true;
      },
    });
  }
  return Decoration.set(out, true);
}

/** Whole-line widgets for top-level tables and `$$` blocks the selection isn't in. */
export function blockDecorations(state: EditorState): DecorationSet {
  const active = activeRanges(state);
  const out: Range<Decoration>[] = [];
  const top = syntaxTree(state).topNode;
  for (let node = top.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table" && node.name !== "BlockMath") continue;
    if (touches(active, node.from, node.to)) continue;
    const source = state.doc.sliceString(node.from, node.to);
    let widget: WidgetType;
    if (node.name === "Table") widget = new TableWidget(source);
    else {
      const marks = node.getChildren("BlockMathMark");
      if (marks.length < 2) continue; // unclosed: leave it as source
      widget = new MathWidget(state.doc.sliceString(marks[0].to, marks[1].from).trim(), true, true, 2);
    }
    out.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
  }
  return Decoration.set(out);
}

const blockField = StateField.define<DecorationSet>({
  create: (state) => blockDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState))
      return blockDecorations(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = liveDecorations(view.state, view.visibleRanges);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      )
        this.decorations = liveDecorations(u.state, u.view.visibleRanges);
    }
  },
  { decorations: (v) => v.decorations },
);

/** The live formatting extension. Needs the language from `markdownExtras`. */
export const livePreview: Extension = [
  inlinePlugin,
  blockField,
  EditorView.editorAttributes.of({ class: "cm-live" }),
];
