// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { applySlashCommand, filterSlashCommands, SLASH_COMMANDS, slashSource } from "./slashMenu";
import { markdownExtras } from "./livePreview";

const lang = markdown({ base: markdownLanguage, extensions: [markdownExtras] });

function stateAt(doc: string, pos = doc.length) {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(pos), extensions: lang });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}
const query = (doc: string, pos?: number) => {
  const s = stateAt(doc, pos);
  return slashSource(new CompletionContext(s, s.selection.main.head, false));
};

/** Run a command on a doc whose `/` query ends at the end; `[`/`]` mark the selection. */
function run(doc: string, label: string) {
  const view = new EditorView({ state: stateAt(doc), parent: document.body });
  const result = query(doc)!;
  const cmd = SLASH_COMMANDS.find((c) => c.label === label)!;
  applySlashCommand(view, cmd, result.from - 1, doc.length);
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  view.destroy();
  return from === to
    ? text.slice(0, from) + "|" + text.slice(from)
    : text.slice(0, from) + "[" + text.slice(from, to) + "]" + text.slice(to);
}

describe("slash menu", () => {
  it("opens at the start of a line or after indentation only", () => {
    expect(query("/")?.options).toHaveLength(SLASH_COMMANDS.length);
    expect(query("text\n  /hea")?.from).toBe(8);
    expect(query("text /")).toBeNull();
    expect(query("/x after", 2)).toBeNull();
    expect(query("/ ")).toBeNull();
  });

  it("stays out of code blocks and the like", () => {
    expect(query("```\n/usr")).toBeNull();
    expect(query("$$\n/")).toBeNull();
  });

  it("filters by label and keyword, best matches first", () => {
    const labels = (q: string) => filterSlashCommands(q).map((c) => c.label);
    expect(labels("h2")).toEqual(["Heading 2"]);
    expect(labels("head")).toEqual(["Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
    expect(labels("todo")).toEqual(["Task list"]);
    expect(labels("hr")).toEqual(["Divider", "Link"]); // "href"
    expect(labels("note")).toEqual(["Callout"]);
    expect(labels("list")).toEqual(["Bullet list", "Numbered list", "Task list"]);
    expect(labels("zzz")).toEqual([]);
    expect(query("/zzz")).toBeNull();
  });

  it("replaces the slash text with Markdown and places the cursor", () => {
    expect(run("/head", "Heading 2")).toBe("## |");
    expect(run("/", "Paragraph")).toBe("|");
    expect(run("a\n\n/task", "Task list")).toBe("a\n\n- [ ] |");
    expect(run("/code", "Code block")).toBe("```\n|\n```");
    expect(run("/", "Callout")).toBe("> [!NOTE]\n> |");
    expect(run("/", "Link")).toBe("[[text]](url)");
    expect(run("/", "Image")).toBe("![]([url])");
    expect(run("/", "Mermaid diagram")).toBe("```mermaid\nflowchart TD\n  [A[Start] --> B[End]]\n```");
  });

  it("separates block inserts from a paragraph above", () => {
    expect(run("para\n/div", "Divider")).toBe("para\n\n---\n|");
    expect(run("para\n\n/math", "Math block")).toBe("para\n\n$$\n|\n$$");
    expect(run("/table", "Table")).toBe(
      "| [Column 1] | Column 2 | Column 3 |\n| --- | --- | --- |\n|          |          |          |",
    );
  });

  it("keeps indentation on continuation lines", () => {
    expect(run("- item\n  /code", "Code block")).toBe("- item\n  ```\n  |\n  ```");
  });
});
