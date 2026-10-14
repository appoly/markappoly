import YAML from "yaml";

/** Minimal YAML frontmatter parser for the reading chrome (title, tags, etc.). */

export type Frontmatter = {
  raw: string;
  /** Body with the frontmatter block removed. */
  body: string;
  /** Simple key → string | string[] map (scalars and inline arrays only). */
  data: Record<string, string | string[]>;
};

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Parse a leading `---` … `---` YAML block. Returns null when the document has
 * no frontmatter so callers can skip the chrome entirely.
 */
export function parseFrontmatter(source: string): Frontmatter | null {
  const m = FM_RE.exec(source);
  if (!m) return null;
  const raw = m[1];
  const body = source.slice(m[0].length);
  return { raw, body, data: parseSimpleYaml(raw) };
}

/**
 * Enough YAML for common Markdown frontmatter: `key: value`, quoted strings,
 * and `[a, b]` / multi-line `- item` lists. Nested maps are ignored.
 */
export function parseSimpleYaml(yaml: string): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "" || val === "|" || val === ">") {
      // Block scalar / empty → collect following indented lines or list items
      const items: string[] = [];
      let nested = false;
      while (i < lines.length) {
        const next = lines[i];
        const listItem = /^\s+-\s+(.*)$/.exec(next);
        if (listItem) {
          items.push(unquote(listItem[1].trim()));
          i += 1;
          continue;
        }
        if (/^\s+\S/.test(next) && val === "" && items.length === 0) {
          // A nested map: not something the simple view can show or edit, so
          // skip its block and leave the key out entirely.
          while (i < lines.length && (/^\s+\S/.test(lines[i]) || !lines[i].trim())) i += 1;
          items.length = 0;
          nested = true;
          break;
        }
        if (/^\s+\S/.test(next) && val !== "") {
          items.push(next.trim());
          i += 1;
          continue;
        }
        break;
      }
      if (!nested) data[key] = items.length ? items : "";
      continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }
    data[key] = unquote(val);
  }
  return data;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function quoteIfNeeded(value: string): string {
  if (value === "") return '""';
  if (
    /[:#[\]{}&*!|>'"%@`,]/.test(value) ||
    value !== value.trim() ||
    /^(true|false|null|~)$/i.test(value)
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Serialize the simple key → value map back to YAML (inverse of parseSimpleYaml). */
export function serializeYaml(data: Record<string, string | string[]>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => quoteIfNeeded(v)).join(", ")}]`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Write edited properties back into the document's frontmatter. Only keys that
 * were added, changed or removed are touched: nested maps, comments, key order
 * and value types (`draft: false` stays a boolean) survive, because the simple
 * map the Properties panel edits only sees top-level scalars and lists.
 * An empty map removes the block entirely.
 */
export function replaceFrontmatter(
  source: string,
  data: Record<string, string | string[]>,
): string {
  const m = FM_RE.exec(source);
  if (!m && Object.keys(data).length === 0) return source;
  if (!m) return `---\n${serializeYaml(data)}\n---\n\n${source}`;

  const doc = YAML.parseDocument(m[1]);
  if (doc.errors.length > 0 || !(YAML.isMap(doc.contents) || doc.contents === null)) {
    // Not YAML we can edit safely: fall back to rewriting the simple map.
    return source.replace(FM_RE, () => `---\n${serializeYaml(data)}\n---\n`);
  }
  const prev = parseSimpleYaml(m[1]);
  for (const key of Object.keys(prev)) {
    if (!(key in data)) doc.delete(key);
  }
  for (const [key, value] of Object.entries(data)) {
    if (key in prev && sameValue(prev[key], value)) continue;
    doc.set(key, toYamlValue(doc.get(key), value));
  }
  if (!YAML.isMap(doc.contents) || doc.contents.items.length === 0) return source.slice(m[0].length);
  let yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, "");
  const eol = m[0].includes("\r\n") ? "\r\n" : "\n";
  if (eol === "\r\n") yaml = yaml.replace(/\r?\n/g, "\r\n");
  // Replacement via a function so `$` sequences in values are kept literal.
  return source.replace(FM_RE, () => `---${eol}${yaml}${eol}---${eol}`);
}

function sameValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Keep the original scalar's type when the panel hands back its text. */
function toYamlValue(existing: unknown, value: string | string[]): unknown {
  if (Array.isArray(value)) return value;
  const typed = typeof existing === "boolean" || typeof existing === "number" || existing === null;
  if (typed || existing === undefined) {
    if (/^(true|false)$/.test(value)) return value === "true";
    if (typed && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  }
  return value;
}

/** Pull a display title from common frontmatter keys. */
export function frontmatterTitle(data: Record<string, string | string[]>): string | null {
  for (const key of ["title", "Title", "name", "Name"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Flatten tags from `tags` / `Tags` whether stored as string or list. */
export function frontmatterTags(data: Record<string, string | string[]>): string[] {
  for (const key of ["tags", "Tags", "keywords", "Keywords"]) {
    const v = data[key];
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      return v
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#/, "").trim())
        .filter(Boolean);
    }
  }
  return [];
}
