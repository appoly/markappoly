// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { reviewMarks, showReviewMarks } from "./editorReview";

function view(doc: string) {
  return new EditorView({
    state: EditorState.create({ doc, extensions: reviewMarks }),
    parent: document.body,
  });
}
const classesOf = (v: EditorView) =>
  [...v.contentDOM.querySelectorAll(".cm-line")].map((l) => l.className.replace("cm-line", "").trim());

describe("editor review marks", () => {
  it("marks added, changed and removed-above lines", () => {
    const v = view("a\nb\nc\nd");
    showReviewMarks(v, [
      { line: 2, kind: "changed" },
      { line: 3, kind: "added" },
      { line: 4, kind: "removed-above" },
    ]);
    expect(classesOf(v)).toEqual(["", "cm-review-changed", "cm-review-added", "cm-review-removed-above"]);
  });

  it("replaces marks on update and clamps past the end", () => {
    const v = view("a\nb");
    showReviewMarks(v, [{ line: 1, kind: "added" }]);
    showReviewMarks(v, [{ line: 9, kind: "removed-above" }]);
    expect(classesOf(v)).toEqual(["", "cm-review-changed"]);
    showReviewMarks(v, []);
    expect(classesOf(v)).toEqual(["", ""]);
  });
});
