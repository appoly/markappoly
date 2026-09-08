import type { Doc } from "./types";

export type SaveIO = {
  readMtime: (path: string) => Promise<number>;
  snapshot: (path: string, force: boolean) => Promise<unknown>;
  write: (path: string, source: string) => Promise<unknown>;
  overwrite: (path: string) => Promise<boolean>;
};

/** A single write per document; late edits must never be marked saved. */
export function createDocumentSaver(
  io: SaveIO,
  get: (id: string) => Doc | undefined,
  patch: (id: string, update: Partial<Doc>) => void,
) {
  const pending = new Map<string, Promise<boolean>>();
  return async function save(id: string, manual = false): Promise<boolean> {
    while (pending.has(id)) await pending.get(id);
    const doc = get(id);
    if (!doc) return false;
    if (!doc.dirty) return true;
    if (!doc.path) return false;
    // An automatic retry must not repeatedly hit an unavailable disk or conflict.
    if (
      !manual &&
      (doc.saveStatus === "error" || doc.saveStatus === "conflict")
    )
      return false;
    const { path, source, mtime } = doc;
    const task = (async () => {
      try {
        const diskMtime = await io.readMtime(path);
        if (mtime !== null && diskMtime !== mtime) {
          patch(id, { saveStatus: "conflict" });
          if (!manual || !(await io.overwrite(path))) return false;
        }
        patch(id, { saveStatus: "saving", saveError: undefined });
        await io.snapshot(path, manual);
        await io.write(path, source);
        const nextMtime = await io.readMtime(path).catch(() => null);
        const unchanged = get(id)?.source === source;
        patch(id, {
          dirty: !unchanged,
          mtime: nextMtime,
          saveStatus: "idle",
          saveError: undefined,
        });
        return unchanged;
      } catch (error) {
        patch(id, { saveStatus: "error", saveError: String(error) });
        return false;
      }
    })();
    pending.set(id, task);
    try {
      return await task;
    } finally {
      if (pending.get(id) === task) pending.delete(id);
    }
  };
}
