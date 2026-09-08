import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Doc } from "./types";

/**
 * Watch open on-disk files via the Rust `notify` watcher. When a file changes
 * externally and the matching tab is clean, reload its contents.
 */
export function useLiveReload(
  docs: Doc[],
  patchDocById: (id: string, patch: Partial<Doc>) => void,
  docsRef: React.RefObject<Doc[]>,
) {
  const patchRef = useRef(patchDocById);
  patchRef.current = patchDocById;

  // Keep the native watcher in sync with open paths only (not every keystroke).
  const pathsKey = docs
    .map((d) => d.path)
    .filter((p): p is string => !!p)
    .join("\0");
  useEffect(() => {
    const paths = pathsKey ? pathsKey.split("\0") : [];
    invoke("set_watched_files", { paths }).catch(() => {});
  }, [pathsKey]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("file-changed", async (e) => {
      const path = e.payload;
      if (!path) return;
      const cur = docsRef.current?.find((d) => d.path === path);
      if (!cur || cur.dirty || cur.saveStatus === "saving") return;
      try {
        const text = await invoke<string>("read_file", { path });
        if (text === cur.source) {
          // Still refresh mtime so we don't thrash if the watcher re-fires.
          try {
            const mtime = await invoke<number>("file_mtime", { path });
            if (
              !docsRef.current?.find((d) => d.id === cur.id)?.dirty &&
              mtime !== cur.mtime
            )
              patchRef.current(cur.id, { mtime });
          } catch {
            /* ignore */
          }
          return;
        }
        let mtime: number | null = null;
        try {
          mtime = await invoke<number>("file_mtime", { path });
        } catch {
          /* ignore */
        }
        // A user may start typing while the disk read is in flight.
        const latest = docsRef.current?.find((d) => d.id === cur.id);
        if (!latest || latest.dirty || latest.source !== cur.source) return;
        patchRef.current(cur.id, {
          source: text,
          dirty: false,
          mtime,
          saveStatus: "idle",
          saveError: undefined,
        });
      } catch {
        /* mid-write or deleted */
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [docsRef]);
}
