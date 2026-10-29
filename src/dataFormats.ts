/**
 * Parsers for the structured data views (CSV/TSV, JSON, JSONL). Each one keeps
 * source offsets, so an edit splices new text into exactly the span it
 * changes and every byte the reader didn't touch is saved as written.
 */

export type DataFormat = "csv" | "tsv" | "json" | "jsonl";

/** The structured format for a path, by extension. */
export function dataFormatFor(path: string | null | undefined): DataFormat | null {
  const m = /\.(csv|tsv|json|jsonl|ndjson)$/i.exec(path ?? "");
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === "ndjson" ? "jsonl" : (ext as DataFormat);
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

// ---------- CSV / TSV ----------

export type CsvRow = {
  /** Offset of the row's first character. */
  start: number;
  /** Offset just past the row's last field (before its line ending). */
  end: number;
  /** Offset where the next row starts (past the line ending), or text length. */
  next: number;
  fields: string[];
  /** Raw [start, end) of each field, quotes included. */
  spans: [number, number][];
};

export type CsvTable = {
  rows: CsvRow[];
  delimiter: string;
  /** The file's line ending, used for rows the view adds. */
  eol: "\n" | "\r\n";
  /** Width of the widest row. */
  columns: number;
};

/**
 * RFC 4180 parse that records where every row and field sits in the source.
 * Quoted fields may hold delimiters, `""` and line breaks. CRLF and LF both
 * end a row; a final line ending does not start an empty row. A leading BOM
 * is skipped (and kept, since it sits outside every span).
 */
export function parseDelimited(text: string, delimiter = ","): CsvTable {
  const rows: CsvRow[] = [];
  let eol: "\n" | "\r\n" | null = null;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const start = i;
    const fields: string[] = [];
    const spans: [number, number][] = [];
    let end = i;
    let next = n;
    for (;;) {
      const fStart = i;
      let value = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q === -1) {
            // Unterminated quote: take the rest of the file as the field.
            value += text.slice(i);
            i = n;
            break;
          }
          value += text.slice(i, q);
          if (text[q + 1] === '"') {
            value += '"';
            i = q + 2;
          } else {
            i = q + 1;
            break;
          }
        }
        // Stray characters after a closing quote stay part of the field.
        while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
          value += text[i++];
        }
      } else {
        while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") i++;
        value = text.slice(fStart, i);
      }
      fields.push(value);
      spans.push([fStart, i]);
      if (i < n && text[i] === delimiter) {
        i++;
        continue;
      }
      end = i;
      if (text[i] === "\r" && text[i + 1] === "\n") {
        eol ??= "\r\n";
        i += 2;
      } else if (text[i] === "\n" || text[i] === "\r") {
        eol ??= "\n";
        i += 1;
      }
      next = i;
      break;
    }
    rows.push({ start, end, next, fields, spans });
  }
  const columns = rows.reduce((m, r) => Math.max(m, r.fields.length), 0);
  return { rows, delimiter, eol: eol ?? "\n", columns };
}

/** A field as it should be written: quoted only when it has to be. */
export function quoteField(value: string, delimiter = ","): string {
  if (value.includes(delimiter) || /["\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serialiseRow(fields: string[], delimiter: string): string {
  return fields.map((f) => quoteField(f, delimiter)).join(delimiter);
}

/**
 * Change one cell. Only that field's span is rewritten; a cell past the end of
 * a short row pads the row with empty fields.
 */
export function setCell(text: string, table: CsvTable, row: number, col: number, value: string): string {
  const r = table.rows[row];
  if (!r) return text;
  const d = table.delimiter;
  if (col < r.spans.length) {
    if (r.fields[col] === value) return text;
    const [s, e] = r.spans[col];
    return splice(text, s, e, quoteField(value, d));
  }
  if (value === "") return text;
  const pad = d.repeat(col - r.spans.length + 1);
  return splice(text, r.end, r.end, pad + quoteField(value, d));
}

/** Append a row (empty cells across the table's width by default). */
export function addRow(text: string, table: CsvTable, values?: string[]): string {
  const width = Math.max(table.columns, 1);
  const fields = values ?? Array.from({ length: width }, () => "");
  const line = serialiseRow(fields, table.delimiter);
  const last = table.rows[table.rows.length - 1];
  if (!last) return text + line + table.eol;
  // Keep the file's habit: a trailing line ending stays trailing.
  if (last.next > last.end) return splice(text, last.next, last.next, line + table.eol);
  return splice(text, last.end, last.end, table.eol + line);
}

/** Remove a row and its line ending. */
export function deleteRow(text: string, table: CsvTable, row: number): string {
  const r = table.rows[row];
  if (!r) return text;
  if (r.next > r.end || row === 0) return splice(text, r.start, r.next, "");
  // Last row without a line ending: take the previous row's ending instead.
  const prev = table.rows[row - 1];
  return splice(text, prev.end, r.end, "");
}

/**
 * Add a column: the header gets `name`, every other row an empty field. Short
 * rows are padded first so the new field lines up with the header.
 */
export function addColumn(text: string, table: CsvTable, name: string): string {
  const d = table.delimiter;
  let out = text;
  for (let i = table.rows.length - 1; i >= 0; i--) {
    const r = table.rows[i];
    const pad = d.repeat(Math.max(table.columns - r.fields.length, 0) + 1);
    out = splice(out, r.end, r.end, pad + (i === 0 ? quoteField(name, d) : ""));
  }
  return out;
}

// ---------- JSON ----------

type Span = { start: number; end: number };
export type JsonEntry = { key: string; keySpan: Span; value: JsonNode };
export type JsonNode = Span &
  (
    | { type: "object"; entries: JsonEntry[] }
    | { type: "array"; items: JsonNode[] }
    | { type: "string"; value: string }
    | { type: "number"; value: number }
    | { type: "boolean"; value: boolean }
    | { type: "null"; value: null }
  );
export type JsonScalar = Extract<JsonNode, { type: "string" | "number" | "boolean" | "null" }>;

export type JsonError = { message: string; offset: number; line: number; column: number };
export type JsonResult = { ok: true; node: JsonNode } | { ok: false; error: JsonError };

/** 1-based line and column of an offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

class Fail extends Error {
  constructor(message: string, public offset: number) {
    super(message);
  }
}

const WS = new Set([" ", "\t", "\n", "\r"]);
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

/** Strict JSON over text[from, to), with absolute offsets on every node. */
function parseRange(text: string, from: number, to: number): JsonNode {
  let i = from;
  const skip = () => {
    while (i < to && WS.has(text[i])) i++;
  };
  const describe = () => (i >= to ? "end of input" : `“${text[i]}”`);

  const parseString = (): { value: string } & Span => {
    const start = i;
    i++; // opening quote
    let value = "";
    for (;;) {
      if (i >= to) throw new Fail("Unterminated string", start);
      const c = text[i];
      if (c === '"') {
        i++;
        return { value, start, end: i };
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Fail("Invalid \\u escape", i);
          value += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e !== undefined && e in ESCAPES) {
          value += ESCAPES[e];
          i += 2;
        } else {
          throw new Fail("Invalid escape in string", i);
        }
        continue;
      }
      if (c < " ") throw new Fail("Unescaped control character in string", i);
      value += c;
      i++;
    }
  };

  const parseValue = (depth: number): JsonNode => {
    if (depth > 512) throw new Fail("Nested too deeply", i);
    skip();
    const start = i;
    const c = text[i];
    if (i >= to) throw new Fail("Unexpected end of input", i);
    if (c === "{") {
      i++;
      const entries: JsonEntry[] = [];
      skip();
      if (text[i] === "}") {
        i++;
        return { type: "object", entries, start, end: i };
      }
      for (;;) {
        skip();
        if (text[i] !== '"') throw new Fail(`Expected a property name, found ${describe()}`, i);
        const key = parseString();
        skip();
        if (text[i] !== ":") throw new Fail(`Expected “:”, found ${describe()}`, i);
        i++;
        const value = parseValue(depth + 1);
        entries.push({ key: key.value, keySpan: { start: key.start, end: key.end }, value });
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return { type: "object", entries, start, end: i };
        }
        throw new Fail(`Expected “,” or “}”, found ${describe()}`, i);
      }
    }
    if (c === "[") {
      i++;
      const items: JsonNode[] = [];
      skip();
      if (text[i] === "]") {
        i++;
        return { type: "array", items, start, end: i };
      }
      for (;;) {
        items.push(parseValue(depth + 1));
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return { type: "array", items, start, end: i };
        }
        throw new Fail(`Expected “,” or “]”, found ${describe()}`, i);
      }
    }
    if (c === '"') {
      const s = parseString();
      return { type: "string", value: s.value, start: s.start, end: s.end };
    }
    for (const [word, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i) && i + word.length <= to) {
        i += word.length;
        return value === null
          ? { type: "null", value, start, end: i }
          : { type: "boolean", value, start, end: i };
      }
    }
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(text);
    if (m && m[0].length > 0 && i + m[0].length <= to) {
      i += m[0].length;
      return { type: "number", value: Number(m[0]), start, end: i };
    }
    throw new Fail(`Unexpected ${describe()}`, i);
  };

  const node = parseValue(0);
  skip();
  if (i < to) throw new Fail(`Unexpected ${describe()} after the end of the value`, i);
  return node;
}

function attempt(text: string, from: number, to: number): JsonResult {
  try {
    return { ok: true, node: parseRange(text, from, to) };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { ok: false, error: { message: e.message, offset: e.offset, ...lineColumn(text, e.offset) } };
  }
}

/** Parse a whole JSON document (a leading BOM is allowed). */
export function parseJson(text: string): JsonResult {
  return attempt(text, text.charCodeAt(0) === 0xfeff ? 1 : 0, text.length);
}

/** True when `raw` is a valid JSON number literal. */
export function isJsonNumber(raw: string): boolean {
  NUMBER_RE.lastIndex = 0;
  const m = NUMBER_RE.exec(raw);
  return !!m && m[0] === raw;
}

/**
 * Replace a scalar with a new value of the same type, rewriting only that
 * value's span. Numbers take their literal text as typed (so `1.50` stays
 * `1.50`); an invalid number leaves the source unchanged.
 */
export function setScalar(text: string, node: JsonScalar, next: string | boolean): string {
  let raw: string;
  if (node.type === "boolean") raw = String(Boolean(next));
  else if (node.type === "number") {
    raw = String(next).trim();
    if (!isJsonNumber(raw)) return text;
  } else if (node.type === "string") raw = JSON.stringify(String(next));
  else return text;
  if (text.slice(node.start, node.end) === raw) return text;
  return splice(text, node.start, node.end, raw);
}

/** The text an inline editor should start with for a scalar. */
export function scalarText(text: string, node: JsonScalar): string {
  if (node.type === "string") return node.value;
  return text.slice(node.start, node.end);
}

// ---------- JSONL ----------

export type JsonLine = {
  /** 1-based line number. */
  line: number;
  start: number;
  end: number;
} & (
  | { status: "blank" }
  | { status: "ok"; node: JsonNode }
  | { status: "error"; error: JsonError }
);

/**
 * One record per line. Blank and invalid lines are reported (never dropped),
 * so the view can flag them and the file round-trips untouched.
 */
export function parseJsonLines(text: string): JsonLine[] {
  const out: JsonLine[] = [];
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    const next = nl === -1 ? text.length : nl + 1;
    let end = nl === -1 ? text.length : nl;
    if (end > start && text[end - 1] === "\r") end--;
    if (text.slice(start, end).trim() === "") out.push({ line, start, end, status: "blank" });
    else {
      const r = attempt(text, start, end);
      if (r.ok) out.push({ line, start, end, status: "ok", node: r.node });
      else {
        const error = { ...r.error, line, column: r.error.offset - start + 1 };
        out.push({ line, start, end, status: "error", error });
      }
    }
    start = next;
    line++;
  }
  return out;
}

// ---------- Shape helpers for the view ----------

/**
 * Column keys when a list of values reads well as a table: every item is an
 * object, and each one shares most of the keys. Null otherwise.
 */
export function tableColumns(items: JsonNode[], maxColumns = 12): string[] | null {
  if (items.length === 0) return null;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type !== "object") return null;
    for (const e of item.entries) {
      if (!seen.has(e.key)) {
        seen.add(e.key);
        keys.push(e.key);
        if (keys.length > maxColumns) return null;
      }
    }
  }
  if (keys.length === 0) return null;
  // Every record fills at least half the columns, and most fill more.
  let total = 0;
  for (const item of items) {
    const n = item.type === "object" ? item.entries.length : 0;
    if (n * 2 < keys.length) return null;
    total += n;
  }
  return total >= 0.6 * keys.length * items.length ? keys : null;
}

/** True when most non-empty values look like numbers (for right alignment). */
export function looksNumeric(values: string[]): boolean {
  let nums = 0;
  let filled = 0;
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    filled++;
    if (/^[-+]?[$€£]?\d[\d,]*(\.\d+)?%?$/.test(t) || /^[-+]?\.\d+$/.test(t)) nums++;
  }
  return filled > 0 && nums / filled >= 0.9;
}
