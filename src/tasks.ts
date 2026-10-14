const TASK_MARKER = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/**
 * Flip the task checkbox on a 1-based source line. Preview checkboxes report
 * the line of their list item (from the parser's positions), so tasks inside
 * fenced code or HTML can never be mistaken for the one that was clicked.
 * Returns the source unchanged when that line isn't a task item.
 */
export function toggleTaskAtLine(source: string, line: number): string {
  const lines = source.split("\n");
  const i = line - 1;
  if (i < 0 || i >= lines.length) return source;
  const m = TASK_MARKER.exec(lines[i]);
  if (!m) return source;
  const next = m[2] === " " ? "[x]" : "[ ]";
  lines[i] = m[1] + next + lines[i].slice(m[0].length);
  return lines.join("\n");
}
