import { describe, expect, it } from "vitest";
import {
  addColumn,
  addRow,
  dataFormatFor,
  deleteRow,
  isJsonNumber,
  looksNumeric,
  parseDelimited,
  parseJson,
  parseJsonLines,
  quoteField,
  scalarText,
  setCell,
  setScalar,
  tableColumns,
  type JsonNode,
  type JsonScalar,
} from "./dataFormats";

describe("dataFormatFor", () => {
  it("maps extensions", () => {
    expect(dataFormatFor("/a/b.CSV")).toBe("csv");
    expect(dataFormatFor("/a/b.tsv")).toBe("tsv");
    expect(dataFormatFor("/a/b.json")).toBe("json");
    expect(dataFormatFor("/a/b.jsonl")).toBe("jsonl");
    expect(dataFormatFor("/a/b.ndjson")).toBe("jsonl");
    expect(dataFormatFor("/a/b.md")).toBeNull();
    expect(dataFormatFor(null)).toBeNull();
  });
});

describe("parseDelimited", () => {
  it("reads simple rows with spans", () => {
    const t = parseDelimited("a,b\n1,2\n");
    expect(t.rows.map((r) => r.fields)).toEqual([["a", "b"], ["1", "2"]]);
    expect(t.rows[1]).toMatchObject({ start: 4, end: 7, next: 8 });
    expect(t.rows[1].spans).toEqual([[4, 5], [6, 7]]);
    expect(t.eol).toBe("\n");
    expect(t.columns).toBe(2);
  });

  it("handles quotes, escaped quotes and embedded line breaks", () => {
    const src = 'name,note\r\n"Smith, J","said ""hi""\r\nthen left"\r\nx,\r\n';
    const t = parseDelimited(src);
    expect(t.eol).toBe("\r\n");
    expect(t.rows.map((r) => r.fields)).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\r\nthen left'],
      ["x", ""],
    ]);
  });

  it("keeps a last row without a line ending, and no phantom empty row", () => {
    expect(parseDelimited("a\nb").rows.map((r) => r.fields)).toEqual([["a"], ["b"]]);
    expect(parseDelimited("a\nb\n").rows).toHaveLength(2);
    expect(parseDelimited("").rows).toHaveLength(0);
  });

  it("reads tabs, ragged rows, a BOM and an unterminated quote", () => {
    const t = parseDelimited("﻿a\tb\tc\n1\n", "\t");
    expect(t.rows[0].start).toBe(1);
    expect(t.rows.map((r) => r.fields)).toEqual([["a", "b", "c"], ["1"]]);
    expect(t.columns).toBe(3);
    expect(parseDelimited('a,"open\nstill').rows[0].fields).toEqual(["a", "open\nstill"]);
  });
});

describe("CSV edits", () => {
  it("rewrites only the edited field", () => {
    const src = 'id,"name"\r\n1,"Ann"\r\n2,Bob\r\n';
    const t = parseDelimited(src);
    expect(setCell(src, t, 2, 1, "Rob")).toBe('id,"name"\r\n1,"Ann"\r\n2,Rob\r\n');
    expect(setCell(src, t, 1, 1, "Ann, Jr")).toBe('id,"name"\r\n1,"Ann, Jr"\r\n2,Bob\r\n');
    expect(setCell(src, t, 1, 1, "Ann")).toBe(src);
  });

  it("pads a short row when editing past its end", () => {
    const src = "a,b,c\n1\n";
    const t = parseDelimited(src);
    expect(setCell(src, t, 1, 2, "z")).toBe("a,b,c\n1,,z\n");
    expect(setCell(src, t, 1, 2, "")).toBe(src);
  });

  it("quotes only when needed", () => {
    expect(quoteField("plain")).toBe("plain");
    expect(quoteField("a,b")).toBe('"a,b"');
    expect(quoteField('say "x"')).toBe('"say ""x"""');
    expect(quoteField("two\nlines")).toBe('"two\nlines"');
    expect(quoteField("a,b", "\t")).toBe("a,b");
    expect(quoteField("a\tb", "\t")).toBe('"a\tb"');
  });

  it("adds rows, keeping the file's line ending habits", () => {
    const crlf = "a,b\r\n1,2\r\n";
    expect(addRow(crlf, parseDelimited(crlf))).toBe("a,b\r\n1,2\r\n,\r\n");
    const bare = "a,b\n1,2";
    expect(addRow(bare, parseDelimited(bare), ["3", "x y"])).toBe("a,b\n1,2\n3,x y");
    expect(addRow("", parseDelimited(""))).toBe("\n");
  });

  it("deletes rows", () => {
    const src = "a\n1\n2\n";
    expect(deleteRow(src, parseDelimited(src), 1)).toBe("a\n2\n");
    const bare = "a\n1\n2";
    expect(deleteRow(bare, parseDelimited(bare), 2)).toBe("a\n1");
    expect(deleteRow(bare, parseDelimited(bare), 0)).toBe("1\n2");
  });

  it("adds a column to every row, padding short ones", () => {
    const src = "a,b\r\n1\r\n2,3";
    expect(addColumn(src, parseDelimited(src), "c d")).toBe("a,b,c d\r\n1,,\r\n2,3,");
    const tsv = "a\tb\n1\t2\n";
    expect(addColumn(tsv, parseDelimited(tsv, "\t"), "new")).toBe("a\tb\tnew\n1\t2\t\n");
  });

  it("detects numeric columns", () => {
    expect(looksNumeric(["1", "2.5", "-3", "", "1,200"])).toBe(true);
    expect(looksNumeric(["1", "two"])).toBe(false);
    expect(looksNumeric(["", ""])).toBe(false);
  });
});

function find(node: JsonNode, path: (string | number)[]): JsonNode {
  let cur = node;
  for (const p of path) {
    if (cur.type === "object") cur = cur.entries.find((e) => e.key === p)!.value;
    else if (cur.type === "array") cur = cur.items[p as number];
  }
  return cur;
}

function parsed(text: string): JsonNode {
  const r = parseJson(text);
  if (!r.ok) throw new Error(r.error.message);
  return r.node;
}

describe("parseJson", () => {
  it("parses every type with offsets", () => {
    const src = '{"a": 1, "b": [true, null, "x\\ny"], "c": {"d": -2.5e3}}';
    const root = parsed(src);
    expect(root).toMatchObject({ type: "object", start: 0, end: src.length });
    const a = find(root, ["a"]);
    expect(a).toMatchObject({ type: "number", value: 1 });
    expect(src.slice(a.start, a.end)).toBe("1");
    expect(find(root, ["b", 0])).toMatchObject({ type: "boolean", value: true });
    expect(find(root, ["b", 1])).toMatchObject({ type: "null" });
    const s = find(root, ["b", 2]);
    expect(s).toMatchObject({ type: "string", value: "x\ny" });
    expect(src.slice(s.start, s.end)).toBe('"x\\ny"');
    expect(find(root, ["c", "d"])).toMatchObject({ value: -2500 });
  });

  it("decodes unicode escapes and allows a BOM", () => {
    expect(parsed('"\\u00e9\\ud83d\\ude00"')).toMatchObject({ value: "é😀" });
    expect(parsed('﻿{"a":1}')).toMatchObject({ type: "object", start: 1 });
  });

  it("reports errors with line and column", () => {
    const r = parseJson('{\n  "a": 1,\n  "b" 2\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBe(7);
      expect(r.error.message).toMatch(/Expected “:”/);
    }
    for (const bad of ["", "{", "[1,]", "{'a':1}", "01", "tru", '"a\tb"', "1 2", "NaN"]) {
      expect(parseJson(bad).ok, bad).toBe(false);
    }
  });
});

describe("JSON edits", () => {
  const src = '{\n  "name": "Ann",\n  "age": 41,\n  "admin": false,\n  "note": null\n}\n';
  const root = parsed(src);
  const node = (k: string) => find(root, [k]) as JsonScalar;

  it("replaces only the value's span", () => {
    expect(setScalar(src, node("name"), 'Bo "B"')).toBe(src.replace('"Ann"', '"Bo \\"B\\""'));
    expect(setScalar(src, node("age"), "42.50")).toBe(src.replace("41", "42.50"));
    expect(setScalar(src, node("admin"), true)).toBe(src.replace("false", "true"));
  });

  it("ignores invalid numbers, null, and no-op edits", () => {
    expect(setScalar(src, node("age"), "4x")).toBe(src);
    expect(setScalar(src, node("note"), "x")).toBe(src);
    expect(setScalar(src, node("age"), "41")).toBe(src);
  });

  it("gives editor text", () => {
    expect(scalarText(src, node("name"))).toBe("Ann");
    expect(scalarText(src, node("age"))).toBe("41");
  });

  it("validates number literals", () => {
    expect(isJsonNumber("-0.5e10")).toBe(true);
    expect(isJsonNumber("1.")).toBe(false);
    expect(isJsonNumber("+1")).toBe(false);
    expect(isJsonNumber("")).toBe(false);
  });
});

describe("parseJsonLines", () => {
  it("parses each line, keeping blank and invalid ones", () => {
    const src = '{"a":1}\r\n\n{oops}\n[2]';
    const lines = parseJsonLines(src);
    expect(lines.map((l) => l.status)).toEqual(["ok", "blank", "error", "ok"]);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4]);
    expect(lines[0]).toMatchObject({ start: 0, end: 7 });
    const err = lines[2];
    if (err.status === "error") expect(err.error).toMatchObject({ line: 3, column: 2 });
  });

  it("edits with absolute offsets", () => {
    const src = '{"a":1}\n{"a":2,"ok":true}\n';
    const second = parseJsonLines(src)[1];
    if (second.status !== "ok") throw new Error("parse");
    const ok = find(second.node, ["ok"]) as JsonScalar;
    expect(setScalar(src, ok, false)).toBe('{"a":1}\n{"a":2,"ok":false}\n');
  });

  it("does not add a record for the trailing newline", () => {
    expect(parseJsonLines('{"a":1}\n')).toHaveLength(1);
    expect(parseJsonLines("")).toHaveLength(0);
  });
});

describe("tableColumns", () => {
  const items = (src: string) => {
    const n = parsed(src);
    return n.type === "array" ? n.items : [];
  };
  it("accepts records that share their keys", () => {
    expect(tableColumns(items('[{"a":1,"b":2},{"a":3,"c":4}]'))).toEqual(["a", "b", "c"]);
  });
  it("rejects mixed or sparse lists", () => {
    expect(tableColumns(items('[{"a":1}, 2]'))).toBeNull();
    expect(tableColumns(items('[{"a":1},{"b":1},{"c":1}]'))).toBeNull();
    expect(tableColumns(items('[{"a":1},{"b":1}]'))).toBeNull();
    expect(tableColumns(items("[{}]"))).toBeNull();
    expect(tableColumns([])).toBeNull();
  });
});
