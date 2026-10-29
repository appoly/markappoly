import type { FileEntry } from "./Sidebar";

export type TreeSort = "name" | "modified";

export type TreeNode =
  | { kind: "dir"; name: string; rel: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

type FileLeaf = { kind: "file"; name: string; path: string; mtime: number };

type DirBuilder = {
  kind: "dir";
  name: string;
  rel: string;
  children: Array<DirBuilder | FileLeaf>;
  dirs: Map<string, DirBuilder>;
};

/**
 * Build a nested folder tree from the flat relative paths returned by
 * `list_markdown_dir` (`name` is relative to the opened folder). Folders come
 * first; `modified` puts the most recently edited file (or the folder holding
 * it) at the top.
 */
export function buildFolderTree(files: FileEntry[], sort: TreeSort = "name"): TreeNode[] {
  const root: DirBuilder = { kind: "dir", name: "", rel: "", children: [], dirs: new Map() };

  for (const f of files) {
    const parts = f.name.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = node.dirs.get(seg);
      if (!child) {
        const rel = node.rel ? `${node.rel}/${seg}` : seg;
        child = { kind: "dir", name: seg, rel, children: [], dirs: new Map() };
        node.dirs.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      kind: "file",
      name: parts[parts.length - 1],
      path: f.path,
      mtime: f.mtime ?? 0,
    });
  }

  return finalize(root, sort).nodes;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

function finalize(dir: DirBuilder, sort: TreeSort): { nodes: TreeNode[]; newest: number } {
  const dirs: { node: TreeNode; name: string; newest: number }[] = [];
  const files: FileLeaf[] = [];
  let newest = 0;
  for (const child of dir.children) {
    if (child.kind === "file") {
      files.push(child);
      newest = Math.max(newest, child.mtime);
    } else {
      const sub = finalize(child, sort);
      newest = Math.max(newest, sub.newest);
      dirs.push({
        node: { kind: "dir", name: child.name, rel: child.rel, children: sub.nodes },
        name: child.name,
        newest: sub.newest,
      });
    }
  }
  if (sort === "modified") {
    dirs.sort((a, b) => b.newest - a.newest || byName(a, b));
    files.sort((a, b) => b.mtime - a.mtime || byName(a, b));
  } else {
    dirs.sort(byName);
    files.sort(byName);
  }
  return {
    nodes: [
      ...dirs.map((d) => d.node),
      ...files.map((f): TreeNode => ({ kind: "file", name: f.name, path: f.path })),
    ],
    newest,
  };
}

/**
 * Where an open path ends up after `from` moved to `to`: the moved file
 * itself, or anything inside a moved folder. Null when it isn't affected.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  for (const sep of ["/", "\\"]) {
    if (path.startsWith(from + sep)) return to + path.slice(from.length);
  }
  return null;
}
