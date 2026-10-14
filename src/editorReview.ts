import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** A changed line in the editor: 1-based line and how it changed. */
export type LineMark = { line: number; kind: "added" | "changed" | "removed-above" };

const setMarks = StateEffect.define<LineMark[]>();

const classes: Record<LineMark["kind"], Decoration> = {
  added: Decoration.line({ class: "cm-review-added" }),
  changed: Decoration.line({ class: "cm-review-changed" }),
  "removed-above": Decoration.line({ class: "cm-review-removed-above" }),
};

const reviewField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const ranges: Range<Decoration>[] = [];
      const lines = tr.state.doc.lines;
      for (const m of [...e.value].sort((a, b) => a.line - b.line)) {
        if (m.line < 1) continue;
        // A removal after the last line marks the last line's bottom edge.
        const n = Math.min(m.line, lines);
        const kind = m.line > lines && m.kind === "removed-above" ? "changed" : m.kind;
        ranges.push(classes[kind].range(tr.state.doc.line(n).from));
      }
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Editor extension that draws change-review marks beside changed lines. */
export const reviewMarks = [
  reviewField,
  EditorView.baseTheme({
    ".cm-review-added": { boxShadow: "inset 3px 0 0 var(--review-added-bar, #2ea043)", backgroundColor: "var(--review-added-bg, rgba(46,160,67,.1))" },
    ".cm-review-changed": { boxShadow: "inset 3px 0 0 var(--review-changed-bar, #c98a12)", backgroundColor: "var(--review-changed-bg, rgba(212,152,25,.12))" },
    ".cm-review-removed-above": { boxShadow: "inset 0 2px 0 var(--review-removed, #d1242f)" },
  }),
];

export function showReviewMarks(view: EditorView, marks: LineMark[]) {
  view.dispatch({ effects: setMarks.of(marks) });
}
