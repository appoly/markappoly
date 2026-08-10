/** Helpers for note templates and daily notes. */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local date as YYYY-MM-DD (daily note names and {{date}}). */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local time as HH:MM ({{time}}). */
export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Substitute {{title}}, {{date}} and {{time}} placeholders in a template.
 * Function replacements keep `$` sequences in the title literal. */
export function fillTemplate(src: string, title: string, now = new Date()): string {
  return src
    .replace(/\{\{\s*title\s*\}\}/gi, () => title)
    .replace(/\{\{\s*date\s*\}\}/gi, () => formatDate(now))
    .replace(/\{\{\s*time\s*\}\}/gi, () => formatTime(now));
}

/**
 * Turn a typed note name into a safe .md file name: strips path separators and
 * characters that are invalid on Windows, then appends `.md` if missing.
 */
export function noteFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return "";
  return /\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

/**
 * Whether a vault-relative file name (as produced by `list_markdown_dir`)
 * lives directly inside the given top-level folder, e.g. `Templates/Meeting.md`.
 */
export function isInFolder(vaultRelName: string, folder: string): boolean {
  const f = folder.trim().toLowerCase();
  if (!f) return false;
  const parts = vaultRelName.split(/[\\/]/);
  return parts.length > 1 && parts[0].toLowerCase() === f;
}
