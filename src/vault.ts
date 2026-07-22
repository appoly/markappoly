import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dirOf, resolveRelativePath } from "./paths";

/** One outgoing link found in a file (matches the Rust `LinkRef`). */
export type LinkRef = { target: string; line: number; text: string; wiki: boolean };
/** Per-file index entry (matches the Rust `FileIndex`). */
export type FileIndex = { path: string; name: string; links: LinkRef[]; tags: string[] };

export type Backlink = {
  path: string;
  name: string;
  contexts: { line: number; text: string }[];
};

export type GraphEdge = { from: string; to: string };

/** Normalize a path for equality checks (mirrors Rust `path_key`). */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

const ANY_EXT_RE = /\.[^./\\]+$/;

/** Basename without extension, lowercased — the wiki-link lookup key. */
export function stemOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(ANY_EXT_RE, "").toLowerCase();
}

/** Split `note#heading|alias` into its parts. */
export function parseWikiTarget(raw: string): { file: string; anchor: string; alias: string } {
  let rest = raw;
  let alias = "";
  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }
  let anchor = "";
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    anchor = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash);
  }
  return { file: rest.trim(), anchor, alias };
}

export type VaultResolver = {
  files: FileIndex[];
  /** Resolve a `[[wiki target]]` to an absolute path, or null when unknown. */
  resolveWiki: (target: string, fromDir?: string) => string | null;
  /** Resolve any indexed link (wiki or relative Markdown) from its source file. */
  resolveLink: (ref: LinkRef, fromPath: string) => string | null;
  backlinksFor: (path: string | null) => Backlink[];
  /** Outgoing resolved targets of a file (absolute paths, deduped). */
  outgoingFor: (path: string | null) => string[];
  tagCounts: () => Map<string, number>;
  byPath: (path: string) => FileIndex | undefined;
};

export function buildResolver(files: FileIndex[], rootDir: string | null): VaultResolver {
  const byStem = new Map<string, FileIndex[]>();
  const byKey = new Map<string, FileIndex>();
  for (const f of files) {
    byKey.set(pathKey(f.path), f);
    const stem = stemOf(f.path);
    const list = byStem.get(stem);
    if (list) list.push(f);
    else byStem.set(stem, [f]);
  }

  const resolveWiki = (target: string, fromDir?: string): string | null => {
    const { file } = parseWikiTarget(target);
    if (!file) return null; // `[[#heading]]` targets the current document
    const wanted = file.replace(/\\/g, "/");
    const candidates = byStem.get(stemOf(wanted)) ?? [];

    if (candidates.length > 0) {
      // A path-qualified target (`folder/note`) must match the tail of the
      // file's vault-relative name.
      const scored = candidates.filter((c) => {
        if (!wanted.includes("/")) return true;
        const rel = pathKey(c.name).replace(ANY_EXT_RE, "");
        return rel === pathKey(wanted) || rel.endsWith("/" + pathKey(wanted));
      });
      const pool = scored.length > 0 ? scored : candidates;
      if (pool.length === 1) return pool[0].path;
      // Prefer a file in the same folder as the source, then the shortest path.
      const sameDir = fromDir
        ? pool.find((c) => pathKey(dirOf(c.path) ?? "") === pathKey(fromDir))
        : undefined;
      if (sameDir) return sameDir.path;
      return [...pool].sort((a, b) => a.path.length - b.path.length)[0].path;
    }

    // Nothing indexed (or no folder open): guess a sibling file so the link
    // still opens when the target exists on disk.
    const base = fromDir ?? rootDir;
    if (!base) return null;
    const withExt = ANY_EXT_RE.test(wanted) ? wanted : `${wanted}.md`;
    return resolveRelativePath(base, withExt);
  };

  const resolveLink = (ref: LinkRef, fromPath: string): string | null => {
    const from = dirOf(fromPath);
    if (ref.wiki) return resolveWiki(ref.target, from);
    if (!from) return null;
    return resolveRelativePath(from, ref.target);
  };

  const backlinksFor = (path: string | null): Backlink[] => {
    if (!path) return [];
    const wanted = pathKey(path);
    const out: Backlink[] = [];
    for (const f of files) {
      if (pathKey(f.path) === wanted) continue;
      const contexts: { line: number; text: string }[] = [];
      for (const link of f.links) {
        const resolved = resolveLink(link, f.path);
        if (resolved && pathKey(resolved) === wanted) {
          contexts.push({ line: link.line, text: link.text });
        }
      }
      if (contexts.length > 0) out.push({ path: f.path, name: f.name, contexts });
    }
    return out;
  };

  const outgoingFor = (path: string | null): string[] => {
    if (!path) return [];
    const f = byKey.get(pathKey(path));
    if (!f) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const link of f.links) {
      const resolved = resolveLink(link, f.path);
      if (!resolved) continue;
      const key = pathKey(resolved);
      if (key === pathKey(path) || seen.has(key)) continue;
      // Only surface targets that exist in the vault.
      if (!byKey.has(key)) continue;
      seen.add(key);
      out.push(byKey.get(key)!.path);
    }
    return out;
  };

  const tagCounts = (): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const f of files) {
      for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  };

  return {
    files,
    resolveWiki,
    resolveLink,
    backlinksFor,
    outgoingFor,
    tagCounts,
    byPath: (path: string) => byKey.get(pathKey(path)),
  };
}

/**
 * Keep a link/tag index of the open folder. Refreshes when the folder changes,
 * when a watched file changes on disk, and when the window regains focus.
 */
export function useVault(folderPath: string | null): {
  resolver: VaultResolver;
  refresh: () => void;
} {
  const [files, setFiles] = useState<FileIndex[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!folderPath) {
      setFiles([]);
      return;
    }
    // Debounce: save + watcher events can arrive in bursts.
    timer.current = setTimeout(async () => {
      try {
        setFiles(await invoke<FileIndex[]>("index_dir", { path: folderPath }));
      } catch {
        setFiles([]);
      }
    }, 250);
  }, [folderPath]);

  useEffect(() => {
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("file-changed", () => refresh()).then((fn) => {
      unlisten = fn;
    });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const resolver = useMemo(() => buildResolver(files, folderPath), [files, folderPath]);
  return { resolver, refresh };
}
