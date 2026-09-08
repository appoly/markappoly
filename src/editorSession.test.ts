import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { historyFields, restoreEditor } from "./editorSession";

describe("editor sessions", () => {
  it("restores text, selection and undo history after switching views", () => {
    let state = EditorState.create({ doc: "hello", extensions: [history()] });
    state = state.update({
      changes: { from: 5, insert: " world" },
      selection: { anchor: 11 },
    }).state;
    const restored = restoreEditor({ state, top: 80, left: 0 }, "hello world")!;
    const next = EditorState.fromJSON(
      restored.json,
      { extensions: [history()] },
      historyFields,
    );
    expect(next.doc.toString()).toBe("hello world");
    expect(next.selection.main.head).toBe(11);
    expect(undoDepth(next)).toBe(1);
  });
  it("uses changed preview content instead of stale cached text", () => {
    const state = EditorState.create({
      doc: "- [ ] Task",
      extensions: [history()],
    });
    const restored = restoreEditor({ state, top: 0, left: 0 }, "- [x] Task")!;
    expect(restored.json.doc).toBe("- [x] Task");
  });
});
