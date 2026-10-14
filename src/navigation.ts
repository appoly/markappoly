import GithubSlugger from "github-slugger";
import type { Heading } from "./headings";
import { MD_EXTENSIONS } from "./paths";

/**
 * Split `guide.md#install` into path and fragment. A `#` only starts a
 * fragment when what follows looks like one (no path separators or dots), so
 * a file genuinely named `notes#2.md` still opens.
 */
export function splitFragment(raw: string): { path: string; fragment: string | null } {
  const hash = raw.lastIndexOf("#");
  if (hash <= 0) return { path: raw, fragment: null };
  const fragment = raw.slice(hash + 1);
  if (/[\\/.]/.test(fragment)) return { path: raw, fragment: null };
  return { path: raw.slice(0, hash), fragment: fragment || null };
}

/** Mirrors EXTERNAL_OPEN_EXTS in src-tauri/src/lib.rs. */
const EXTERNAL_EXTS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "avif",
  "ico", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "m4v", "mov", "webm", "csv", "tsv",
  "xlsx", "xls", "docx", "doc", "pptx", "ppt", "key", "pages", "numbers", "odt", "ods",
  "odp", "rtf", "epub", "html", "htm",
]);
/**
 * Binaries: not readable as text, and not safe to hand to another app. Scripts
 * (.sh, .ps1, .bat…) are text, so they open read-only in the code view and are
 * never run.
 */
const BLOCKED_EXTS = new Set([
  "app", "exe", "msi", "com", "scpt", "jar", "dmg", "pkg", "deb", "rpm", "appimage", "zip", "gz", "tgz", "7z", "rar", "dll", "so",
  "dylib", "bin", "o", "a", "class", "wasm", "sqlite", "db", "woff", "woff2", "ttf", "otf",
]);

export type FileKind = "markdown" | "text" | "external" | "blocked";

/** How a linked file should open: as a document, as code, or in another app. */
export function fileKind(path: string): FileKind {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (MD_EXTENSIONS.includes(ext)) return "markdown";
  if (EXTERNAL_EXTS.has(ext)) return "external";
  if (BLOCKED_EXTS.has(ext)) return "blocked";
  return "text";
}

/** Line numbers from GitHub-style `#L42` or `#L42-L50` fragments. */
export function lineFromFragment(fragment: string): number | null {
  const m = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment);
  return m ? Number(m[1]) : null;
}

/** The heading a fragment points to: an exact slug, or the slug of its text. */
export function headingForFragment(headings: Heading[], fragment: string): Heading | null {
  let wanted = fragment;
  try {
    wanted = decodeURIComponent(fragment);
  } catch {
    /* keep raw */
  }
  const exact = headings.find((h) => h.slug === wanted);
  if (exact) return exact;
  const slug = new GithubSlugger().slug(wanted);
  return headings.find((h) => h.slug === slug) ?? null;
}

export type NavEntry = { docId: string; path: string | null; scroll: number };

/** Browser-style back/forward stacks for moving between documents and sections. */
export class NavHistory {
  private back: NavEntry[] = [];
  private forward: NavEntry[] = [];
  constructor(private limit = 100) {}

  /** Record where the reader was, just before following a link. */
  push(from: NavEntry) {
    const last = this.back[this.back.length - 1];
    if (last && last.docId === from.docId && Math.abs(last.scroll - from.scroll) < 4) return;
    this.back.push(from);
    if (this.back.length > this.limit) this.back.shift();
    this.forward = [];
  }

  goBack(current: NavEntry): NavEntry | null {
    const to = this.back.pop();
    if (!to) return null;
    this.forward.push(current);
    return to;
  }

  goForward(current: NavEntry): NavEntry | null {
    const to = this.forward.pop();
    if (!to) return null;
    this.back.push(current);
    return to;
  }

  get canGoBack() {
    return this.back.length > 0;
  }
  get canGoForward() {
    return this.forward.length > 0;
  }

  /** Forget a closed, unsaved tab (it can't be reopened by path). */
  dropDoc(docId: string) {
    const keep = (e: NavEntry) => e.docId !== docId || e.path !== null;
    this.back = this.back.filter(keep);
    this.forward = this.forward.filter(keep);
  }
}
