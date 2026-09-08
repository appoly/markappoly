import type { EditorState } from "@codemirror/state";
import { historyField } from "@codemirror/commands";

export type EditorSession = { state: EditorState; top: number; left: number };
export const historyFields = { history: historyField };

/** Serialize only when mounting, not on every keystroke. External edits join history. */
export function restoreEditor(
  session: EditorSession | undefined,
  source: string,
) {
  if (!session) return undefined;
  const state =
    session.state.doc.toString() === source
      ? session.state
      : session.state.update({
          changes: { from: 0, to: session.state.doc.length, insert: source },
        }).state;
  return { json: state.toJSON(historyFields), fields: historyFields };
}
