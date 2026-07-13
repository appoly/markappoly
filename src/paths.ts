/** Path helpers shared by the UI and the Markdown preview. */

const MD_EXT_RE = /\.(md|markdown|mdown|mkd|mkdn|txt)$/i;

export function basename(path: string | null | undefined): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? "Untitled";
}

export function dirOf(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const cut = path.replace(/[\\/][^\\/]*$/, "");
  return cut === path ? undefined : cut;
}

/** True for absolute POSIX or Windows paths. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

/**
 * Resolve a relative link target against a document directory.
 * Strips a leading `./`, normalizes `..` segments, and keeps the host separator style.
 */
export function resolveRelativePath(baseDir: string, href: string): string {
  let target = href.trim();
  // Drop optional title and anchors for file resolution: `notes.md#section` → `notes.md`
  const hash = target.indexOf("#");
  if (hash !== -1) target = target.slice(0, hash);
  // Strip surrounding angle brackets sometimes used in autolinks
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  target = target.replace(/^file:\/\//, "");

  if (!target) return baseDir;
  if (isAbsolutePath(target)) return target;

  const sep = baseDir.includes("\\") ? "\\" : "/";
  const baseParts = baseDir.split(/[\\/]/).filter(Boolean);
  // Keep Windows drive letter as first part (e.g. "C:")
  const isWin = /^[a-zA-Z]:$/.test(baseParts[0] ?? "");
  const parts = [...baseParts];

  for (const seg of target.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > (isWin ? 1 : 0)) parts.pop();
      continue;
    }
    parts.push(seg);
  }

  if (isWin) {
    return parts.join(sep);
  }
  return "/" + parts.join("/");
}

/** Whether a link target looks like a local Markdown (or plain text) file. */
export function isLocalMarkdownHref(href: string): boolean {
  if (!href || href.startsWith("#")) return false;
  if (/^(https?:|mailto:|javascript:|data:|blob:|asset:)/i.test(href)) return false;
  // Strip hash/query for extension check
  const bare = href.split(/[#?]/)[0].replace(/^file:\/\//, "");
  if (!bare) return false;
  // Extension-less relative paths like `./notes` are treated as non-md
  return MD_EXT_RE.test(bare);
}

export const MD_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"];
