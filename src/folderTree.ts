import type { FileEntry } from "./Sidebar";

export type TreeNode =
  | { kind: "dir"; name: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

type DirBuilder = {
  kind: "dir";
  name: string;
  children: Array<DirBuilder | { kind: "file"; name: string; path: string }>;
  dirs: Map<string, DirBuilder>;
};

/**
 * Build a nested folder tree from the flat relative paths returned by
 * `list_markdown_dir` (`name` is relative to the opened folder).
 */
export function buildFolderTree(files: FileEntry[]): TreeNode[] {
  const root: DirBuilder = { kind: "dir", name: "", children: [], dirs: new Map() };

  const sorted = [...files].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  for (const f of sorted) {
    const parts = f.name.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = node.dirs.get(seg);
      if (!child) {
        child = { kind: "dir", name: seg, children: [], dirs: new Map() };
        node.dirs.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", name: parts[parts.length - 1], path: f.path });
  }

  return finalize(root);
}

function finalize(dir: DirBuilder): TreeNode[] {
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];
  for (const child of dir.children) {
    if (child.kind === "file") {
      files.push(child);
    } else {
      dirs.push({ kind: "dir", name: child.name, children: finalize(child) });
    }
  }
  return [...dirs, ...files];
}
