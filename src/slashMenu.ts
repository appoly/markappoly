import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { TABLE_TEMPLATE } from "./tableTools";

/**
 * The slash menu: `/` at the start of an otherwise empty line lists every
 * block the editor knows. Picking one replaces the `/query` with plain
 * Markdown and leaves the cursor (or a selected placeholder) where you'd type
 * next. It is a completion source, combined with the wiki-link source in
 * wikiComplete.ts because CodeMirror allows only one `override` list.
 */
export type SlashCommand = {
  label: string;
  /** Shown beside the label: the Markdown it inserts. */
  detail: string;
  keywords: string[];
  /** Text before the selection, the selected placeholder, and text after. */
  before: string;
  selected?: string;
  after?: string;
  /** Needs a blank line above, or it would join the paragraph before it. */
  block?: boolean;
};

const tableAt = TABLE_TEMPLATE.indexOf("Column 1");

export const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Paragraph", detail: "text", keywords: ["text", "plain", "p"], before: "" },
  ...[1, 2, 3, 4].map((n) => ({
    label: `Heading ${n}`,
    detail: "#".repeat(n),
    keywords: [`h${n}`, "title", "heading"],
    before: "#".repeat(n) + " ",
  })),
  { label: "Bullet list", detail: "-", keywords: ["ul", "unordered", "list"], before: "- " },
  { label: "Numbered list", detail: "1.", keywords: ["ol", "ordered", "list"], before: "1. " },
  { label: "Task list", detail: "- [ ]", keywords: ["todo", "checkbox", "checklist"], before: "- [ ] " },
  { label: "Quote", detail: ">", keywords: ["blockquote", "cite"], before: "> " },
  { label: "Code block", detail: "```", keywords: ["fence", "pre", "snippet"], before: "```\n", after: "\n```" },
  {
    label: "Table",
    detail: "| |",
    keywords: ["grid", "columns"],
    before: TABLE_TEMPLATE.slice(0, tableAt),
    selected: "Column 1",
    after: TABLE_TEMPLATE.slice(tableAt + "Column 1".length),
    block: true,
  },
  {
    label: "Math block",
    detail: "$$",
    keywords: ["latex", "equation", "formula", "katex"],
    before: "$$\n",
    after: "\n$$",
    block: true,
  },
  {
    label: "Mermaid diagram",
    detail: "```mermaid",
    keywords: ["diagram", "flowchart", "chart", "graph"],
    before: "```mermaid\nflowchart TD\n  ",
    selected: "A[Start] --> B[End]",
    after: "\n```",
  },
  {
    label: "Callout",
    detail: "> [!NOTE]",
    keywords: ["note", "admonition", "alert", "tip", "warning"],
    before: "> [!NOTE]\n> ",
  },
  { label: "Divider", detail: "---", keywords: ["hr", "rule", "line", "separator"], before: "---\n", block: true },
  { label: "Image", detail: "![]()", keywords: ["img", "picture", "photo"], before: "![](", selected: "url", after: ")" },
  { label: "Link", detail: "[]()", keywords: ["url", "href", "anchor"], before: "[", selected: "text", after: "](url)" },
];

/** Commands matching what was typed after the slash, best matches first. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return SLASH_COMMANDS;
  const rank = (cmd: SlashCommand) => {
    const label = cmd.label.toLowerCase();
    if (label.replace(/\s+/g, "").startsWith(q)) return 0;
    if (cmd.keywords.some((k) => k.startsWith(q)) || label.split(" ").some((w) => w.startsWith(q))) return 1;
    if (label.replace(/\s+/g, "").includes(q)) return 2;
    return -1;
  };
  return SLASH_COMMANDS.map((cmd, i) => ({ cmd, i, r: rank(cmd) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((m) => m.cmd);
}

/**
 * Replace `from..to` (the slash and its query) with the command's Markdown.
 * Continuation lines keep the line's indentation, so blocks nest in lists.
 */
export function applySlashCommand(view: EditorView, cmd: SlashCommand, from: number, to: number) {
  const { doc } = view.state;
  const line = doc.lineAt(from);
  const indent = /^\s*/.exec(line.text)![0];
  const nl = (s = "") => s.replace(/\n/g, "\n" + indent);
  const prev = line.number > 1 ? doc.line(line.number - 1).text : "";
  const lead = cmd.block && prev.trim() !== "" ? "\n" + indent : "";
  const before = lead + nl(cmd.before);
  const selected = nl(cmd.selected);
  view.dispatch({
    changes: { from, to, insert: before + selected + nl(cmd.after) },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
    scrollIntoView: true,
    userEvent: "input.complete",
  });
}

// Blocks where a slash is just text (paths in code, YAML, math).
const LITERAL = new Set(["FencedCode", "CodeBlock", "BlockMath", "Frontmatter", "HTMLBlock", "CommentBlock"]);

export function slashSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /^(\s*)\/(\w[\w ]*)?$/.exec(before);
  if (!m || line.text.slice(ctx.pos - line.from).trim()) return null;
  for (let n: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent)
    if (LITERAL.has(n.name)) return null;
  const query = m[2] ?? "";
  const matches = filterSlashCommands(query);
  if (!matches.length) return null;
  const options: Completion[] = matches.map((cmd, i) => ({
    label: cmd.label,
    detail: cmd.detail,
    type: "text",
    // Our ranking, not CodeMirror's alphabetical tie-break.
    boost: -i,
    apply: (view, _completion, from, to) => applySlashCommand(view, cmd, from - 1, to),
  }));
  // `from` is after the slash so the query is what gets matched; the slash
  // itself is replaced by applySlashCommand.
  return { from: line.from + m[1].length + 1, options, filter: false };
}
