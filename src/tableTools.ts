import type { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";

/** Helpers for creating and tidying GFM pipe tables in the editor. */

type Block = { start: number; end: number }; // 1-based, inclusive line numbers

function findTable(doc: Text, pos: number): Block | null {
  const cur = doc.lineAt(pos).number;
  if (!doc.line(cur).text.includes("|")) return null;
  let start = cur;
  let end = cur;
  while (start > 1 && doc.line(start - 1).text.includes("|")) start--;
  while (end < doc.lines && doc.line(end + 1).text.includes("|")) end++;
  return { start, end };
}

const SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const isSep = (line: string) => SEP_RE.test(line) && line.includes("-");

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Render a matrix back to an aligned GFM table; the separator row is regenerated. */
function renderTable(rows: string[][], sepIndex: number): string {
  const bodyLengths = rows.filter((_, i) => i !== sepIndex).map((r) => r.length);
  const cols = Math.max(...bodyLengths, 1);
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 3; // room for "---"
    rows.forEach((r, i) => {
      if (i !== sepIndex) w = Math.max(w, (r[c] ?? "").length);
    });
    widths.push(w);
  }
  return rows
    .map((r, i) => {
      if (i === sepIndex) return "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
      return "| " + widths.map((w, c) => (r[c] ?? "").padEnd(w)).join(" | ") + " |";
    })
    .join("\n");
}

/** Parse the table at the cursor, transform its matrix, and write it back aligned. */
function editTable(
  view: EditorView,
  transform: (rows: string[][], sepIndex: number) => { rows: string[][]; sepIndex: number },
): boolean {
  const doc = view.state.doc;
  const blk = findTable(doc, view.state.selection.main.from);
  if (!blk) return false;

  const rawRows: string[][] = [];
  let sepIndex = -1;
  for (let n = blk.start; n <= blk.end; n++) {
    const text = doc.line(n).text;
    if (sepIndex === -1 && isSep(text)) sepIndex = n - blk.start;
    rawRows.push(splitCells(text));
  }
  if (sepIndex === -1) return false; // not a real table — no separator row

  const { rows, sepIndex: si } = transform(rawRows, sepIndex);
  const from = doc.line(blk.start).from;
  const to = doc.line(blk.end).to;
  view.dispatch({ changes: { from, to, insert: renderTable(rows, si) }, selection: { anchor: from } });
  view.focus();
  return true;
}

const TEMPLATE =
  "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|          |          |          |";

/** Insert a 3-column table skeleton on its own lines, cursor in the first cell. */
export function insertTable(view: EditorView) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  if (line.text.trim() === "") {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: TEMPLATE },
      selection: { anchor: line.from + 2 },
    });
  } else {
    view.dispatch({
      changes: { from: line.to, insert: "\n\n" + TEMPLATE },
      selection: { anchor: line.to + 4 },
    });
  }
  view.focus();
}

/** Append a blank row to the table at the cursor. */
export const addRow = (view: EditorView) =>
  editTable(view, (rows, sepIndex) => {
    const cols = Math.max(rows[sepIndex]?.length ?? 0, rows[0]?.length ?? 1);
    return { rows: [...rows, Array(cols).fill("")], sepIndex };
  });

/** Add a trailing column to every row of the table at the cursor. */
export const addColumn = (view: EditorView) =>
  editTable(view, (rows, sepIndex) => ({
    rows: rows.map((r, i) => (i === sepIndex ? [...r, "---"] : [...r, ""])),
    sepIndex,
  }));

/** Re-pad the table at the cursor so the columns line up. */
export const formatTable = (view: EditorView) =>
  editTable(view, (rows, sepIndex) => ({ rows, sepIndex }));
