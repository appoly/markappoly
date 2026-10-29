import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CodeView } from "./CodeView";
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
  scalarText,
  setCell,
  setScalar,
  tableColumns,
  type JsonError,
  type JsonNode,
  type JsonScalar,
} from "./dataFormats";
import { ChevronIcon, PlusIcon } from "./icons";
import "./DataView.css";

const CSV_PAGE = 2000;
const JSON_PAGE = 100;
const JSONL_PAGE = 500;

/**
 * Edits go through here: each one remembers the text it replaced, so the
 * toolbar can step back. An undo only applies while the file still holds
 * what the edit wrote; a reload from disk quietly invalidates the stack.
 */
function useEdits(source: string, onChange: (next: string) => void) {
  const stack = useRef<{ before: string; after: string }[]>([]);
  const emitted = useRef(source);
  const emit = useCallback(
    (next: string) => {
      if (next === source) return;
      stack.current.push({ before: source, after: next });
      if (stack.current.length > 100) stack.current.shift();
      emitted.current = next;
      onChange(next);
    },
    [source, onChange],
  );
  const top = stack.current[stack.current.length - 1];
  const canUndo = !!top && top.after === source;
  const undo = useCallback(() => {
    const last = stack.current[stack.current.length - 1];
    if (!last || last.after !== source) return;
    stack.current.pop();
    emitted.current = last.before;
    onChange(last.before);
  }, [source, onChange]);
  /** True when the current text came from somewhere else (a reload). */
  const external = source !== emitted.current;
  return { emit, undo, canUndo, external };
}

type EditCtx = { source: string; emit: (next: string) => void };
const Edit = createContext<EditCtx>({ source: "", emit: () => {} });

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function Toolbar({
  summary,
  canUndo,
  onUndo,
  children,
}: {
  summary: ReactNode;
  canUndo: boolean;
  onUndo: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="dv-toolbar" role="toolbar" aria-label="Data">
      <span className="dv-summary">{summary}</span>
      <span className="dv-actions">
        {canUndo && (
          <button type="button" className="dv-button" onClick={onUndo} title="Undo the last change">
            <UndoIcon />
            Undo
          </button>
        )}
        {children}
      </span>
    </div>
  );
}

const UndoIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H8" />
  </svg>
);

const RemoveIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="currentColor" />
    <path d="M5 8h6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
  </svg>
);

/**
 * In-place text editor for a cell or value. Enter commits (Shift/Option+Enter
 * adds a line break), Esc cancels, Tab commits and asks to move on. Leaving
 * the field commits too, unless `valid` rejects the text.
 */
function InlineEditor({
  initial,
  onCommit,
  onCancel,
  onTab,
  valid,
  numeric,
  label,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onTab?: (value: string, back: boolean) => void;
  valid?: (value: string) => boolean;
  numeric?: boolean;
  label: string;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ok = !valid || valid(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  useLayoutEffect(() => {
    // Grow with the text, so multi-line values stay readable while editing.
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      finish(onCancel);
    } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (ok) finish(() => onCommit(value));
    } else if (e.key === "Tab" && onTab) {
      e.preventDefault();
      if (ok) finish(() => onTab(value, e.shiftKey));
    }
  };
  return (
    <textarea
      ref={ref}
      className={`dv-input${numeric ? " numeric" : ""}`}
      value={value}
      rows={1}
      spellCheck={false}
      aria-label={label}
      aria-invalid={!ok || undefined}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(() => (ok ? onCommit(value) : onCancel()))}
    />
  );
}

// ---------- CSV / TSV ----------

type Cell = { row: number; col: number };

function CsvView({ source, delimiter, onChange }: {
  source: string;
  delimiter: string;
  onChange: (next: string) => void;
}) {
  const table = useMemo(() => parseDelimited(source, delimiter), [source, delimiter]);
  const { emit, undo, canUndo, external } = useEdits(source, onChange);
  const [editing, setEditing] = useState<Cell | null>(null);
  const [limit, setLimit] = useState(CSV_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A reload from disk can move rows around: drop any edit in progress.
  useEffect(() => {
    if (external) setEditing(null);
  }, [external, source]);

  const width = Math.max(table.columns, 1);
  const header = table.rows[0];
  const body = table.rows.length - 1;
  const shown = Math.min(Math.max(body, 0), limit);

  const numeric = useMemo(() => {
    const sample = table.rows.slice(1, 201);
    return Array.from({ length: width }, (_, c) => looksNumeric(sample.map((r) => r.fields[c] ?? "")));
  }, [table, width]);

  const commit = (cell: Cell, value: string, then: Cell | null = null) => {
    emit(setCell(source, table, cell.row, cell.col, value));
    setEditing(then);
  };
  const step = ({ row, col }: Cell, back: boolean): Cell | null => {
    let r = row;
    let c = col + (back ? -1 : 1);
    if (c >= width) [r, c] = [r + 1, 0];
    if (c < 0) [r, c] = [r - 1, width - 1];
    if (r < 0 || r > shown) return null;
    return { row: r, col: c };
  };

  const appendRow = () => {
    emit(addRow(source, table));
    // The new row's index is the old row count (row 0 when the file was empty).
    const row = table.rows.length;
    if (row > limit) setLimit(row);
    setEditing({ row, col: 0 });
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };
  const appendColumn = () => {
    if (table.rows.length === 0) {
      emit(addRow(source, table, ["Column 1"]));
      setEditing({ row: 0, col: 0 });
      return;
    }
    emit(addColumn(source, table, `Column ${width + 1}`));
    setEditing({ row: 0, col: table.columns });
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  };

  const cell = (row: number, col: number, value: string, head: boolean) => {
    const Tag = head ? "th" : "td";
    const isEditing = editing?.row === row && editing.col === col;
    const name = header?.fields[col] || `Column ${col + 1}`;
    const cls = [numeric[col] && !head ? "numeric" : "", isEditing ? "editing" : ""]
      .filter(Boolean).join(" ");
    return (
      <Tag
        key={col}
        className={cls || undefined}
        onClick={isEditing ? undefined : () => setEditing({ row, col })}
        title={value.length > 60 ? value : undefined}
      >
        {isEditing ? (
          <InlineEditor
            initial={value}
            label={head ? `Header ${col + 1}` : `${name}, row ${row}`}
            numeric={numeric[col] && !head}
            onCommit={(v) => commit({ row, col }, v)}
            onCancel={() => setEditing(null)}
            onTab={(v, back) => commit({ row, col }, v, step({ row, col }, back))}
          />
        ) : (
          <span className="dv-cell-text">{value}</span>
        )}
      </Tag>
    );
  };

  const rowCells = (r: number) => {
    const fields = table.rows[r]?.fields ?? [];
    return Array.from({ length: width }, (_, c) => cell(r, c, fields[c] ?? "", r === 0));
  };

  return (
    <div className="data-view">
      <Toolbar
        summary={
          table.rows.length === 0 ? "Empty table" : (
            <>
              {plural(body, "row")} · {plural(width, "column")}
              {shown < body && <span className="dv-muted"> · showing first {shown.toLocaleString()}</span>}
            </>
          )
        }
        canUndo={canUndo}
        onUndo={undo}
      >
        <button type="button" className="dv-button" onClick={appendRow}>
          <PlusIcon />
          Row
        </button>
        <button type="button" className="dv-button" onClick={appendColumn}>
          <PlusIcon />
          Column
        </button>
      </Toolbar>
      <div className="dv-scroll" ref={scrollRef}>
        {table.rows.length > 0 && (
          <table className="dv-table dv-grid">
            <thead>
              <tr>
                <th className="dv-rownum" aria-label="Row" />
                {rowCells(0)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: shown }, (_, i) => {
                const r = i + 1;
                return (
                  <tr key={r}>
                    <th className="dv-rownum" scope="row">
                      <span className="dv-rownum-n">{r}</span>
                      <button
                        type="button"
                        className="dv-row-remove"
                        title={`Delete row ${r}`}
                        aria-label={`Delete row ${r}`}
                        onClick={() => {
                          setEditing(null);
                          emit(deleteRow(source, table, r));
                        }}
                      >
                        <RemoveIcon />
                      </button>
                    </th>
                    {rowCells(r)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {shown < body && (
          <ShowMore
            remaining={body - shown}
            step={CSV_PAGE}
            noun="row"
            onClick={() => setLimit((l) => l + CSV_PAGE)}
          />
        )}
      </div>
    </div>
  );
}

function ShowMore({ remaining, step, noun, onClick }: {
  remaining: number;
  step: number;
  noun: string;
  onClick: () => void;
}) {
  return (
    <div className="dv-more">
      <button type="button" className="dv-button" onClick={onClick}>
        Show {Math.min(step, remaining).toLocaleString()} more
      </button>
      <span className="dv-muted">{plural(remaining, `${noun} hidden`, `${noun}s hidden`)}</span>
    </div>
  );
}

// ---------- JSON ----------

function containerSummary(node: JsonNode): string {
  if (node.type === "object") return plural(node.entries.length, "field");
  if (node.type === "array") return plural(node.items.length, "item");
  return "";
}

/** A string, number, boolean or null, editable in place where it can be. */
function Scalar({ node, label }: { node: JsonScalar; label: string }) {
  const { source, emit } = useContext(Edit);
  const [editing, setEditing] = useState(false);
  if (node.type === "boolean") {
    return (
      <button
        type="button"
        className={`switch dv-switch${node.value ? " on" : ""}`}
        role="switch"
        aria-checked={node.value}
        aria-label={label}
        onClick={() => emit(setScalar(source, node, !node.value))}
      >
        <span className="switch-knob" />
      </button>
    );
  }
  if (node.type === "null") return <span className="dv-null">null</span>;
  if (editing) {
    return (
      <InlineEditor
        initial={scalarText(source, node)}
        label={label}
        numeric={node.type === "number"}
        valid={node.type === "number" ? (v) => isJsonNumber(v.trim()) : undefined}
        onCommit={(v) => {
          setEditing(false);
          emit(setScalar(source, node, v));
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  const text = scalarText(source, node);
  return (
    <button
      type="button"
      className={`dv-scalar ${node.type}${text === "" ? " empty" : ""}`}
      onClick={() => setEditing(true)}
      aria-label={`${label}: ${text || "empty"}. Edit`}
    >
      {text === "" ? "Empty" : text}
    </button>
  );
}

function JsonValue({ node, label, depth }: { node: JsonNode; label: string; depth: number }) {
  if (node.type === "object") return <Fields node={node} depth={depth} />;
  if (node.type === "array") return <ArrayValue node={node} label={label} depth={depth} />;
  return <Scalar node={node} label={label} />;
}

/** One labelled row; objects and arrays fold open beneath their label. */
function Field({ name, node, depth, index }: {
  name: string;
  node: JsonNode;
  depth: number;
  index?: boolean;
}) {
  const container = node.type === "object" || node.type === "array";
  const empty = (node.type === "object" && node.entries.length === 0) ||
    (node.type === "array" && node.items.length === 0);
  const [open, setOpen] = useState(depth < 2);
  const keyCls = `dv-key${index ? " index" : ""}`;
  if (!container || empty) {
    return (
      <div className="dv-field">
        <span className={keyCls} title={name}>{name}</span>
        <span className="dv-value">
          {container ? (
            <span className="dv-null">{node.type === "object" ? "No fields" : "No items"}</span>
          ) : (
            <JsonValue node={node} label={name} depth={depth + 1} />
          )}
        </span>
      </div>
    );
  }
  return (
    <div className={`dv-group${open ? " open" : ""}`}>
      <button
        type="button"
        className="dv-disclosure"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronIcon />
        <span className={keyCls}>{name}</span>
        <span className="dv-muted">{containerSummary(node)}</span>
      </button>
      {open && (
        <div className="dv-nested">
          <JsonValue node={node} label={name} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function Fields({ node, depth }: { node: Extract<JsonNode, { type: "object" }>; depth: number }) {
  return (
    <div className="dv-fields">
      {node.entries.map((e, i) => (
        <Field key={`${i}:${e.key}`} name={e.key} node={e.value} depth={depth} />
      ))}
    </div>
  );
}

function ArrayValue({ node, label, depth }: {
  node: Extract<JsonNode, { type: "array" }>;
  label: string;
  depth: number;
}) {
  const [limit, setLimit] = useState(JSON_PAGE);
  const columns = useMemo(() => tableColumns(node.items), [node]);
  const shown = node.items.slice(0, limit);
  const more = node.items.length - shown.length;
  return (
    <>
      {columns ? (
        <RecordTable
          records={shown.map((n, i) => ({ key: String(i), label: String(i + 1), node: n }))}
          columns={columns}
          label={label}
        />
      ) : (
        <div className="dv-fields">
          {shown.map((item, i) => (
            <Field key={i} name={String(i)} node={item} depth={depth} index />
          ))}
        </div>
      )}
      {more > 0 && (
        <ShowMore remaining={more} step={JSON_PAGE} noun="item" onClick={() => setLimit((l) => l + JSON_PAGE)} />
      )}
    </>
  );
}

type RecordRow =
  | { key: string; label: string; node: JsonNode }
  | { key: string; label: string; error: string; raw: string };

/** A list of similar records as a compact table, one column per key. */
function RecordTable({ records, columns, label }: {
  records: RecordRow[];
  columns: string[];
  label: string;
}) {
  const { source } = useContext(Edit);
  return (
    <div className="dv-table-wrap">
      <table className="dv-table dv-records">
        <thead>
          <tr>
            <th className="dv-rownum" aria-label="Index" />
            {columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.key} className={"error" in r ? "invalid" : undefined}>
              <th className="dv-rownum" scope="row">{r.label}</th>
              {"error" in r ? (
                <td colSpan={columns.length}>
                  <span className="dv-error-text">{r.error}</span>
                  <code className="dv-raw">{r.raw}</code>
                </td>
              ) : (
                columns.map((c) => {
                  const entry = r.node.type === "object"
                    ? r.node.entries.find((e) => e.key === c) : undefined;
                  const v = entry?.value;
                  return (
                    <td key={c}>
                      {!v ? (
                        <span className="dv-absent" aria-label="Missing">–</span>
                      ) : v.type === "object" || v.type === "array" ? (
                        <span className="dv-chip" title={source.slice(v.start, Math.min(v.end, v.start + 400))}>
                          {containerSummary(v)}
                        </span>
                      ) : (
                        <Scalar node={v} label={`${label} ${r.label} ${c}`} />
                      )}
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonDocument({ source, node, onChange }: {
  source: string;
  node: JsonNode;
  onChange: (next: string) => void;
}) {
  const { emit, undo, canUndo } = useEdits(source, onChange);
  const ctx = useMemo(() => ({ source, emit }), [source, emit]);
  const summary =
    node.type === "object" ? `Object · ${containerSummary(node)}`
    : node.type === "array" ? `List · ${containerSummary(node)}`
    : "Value";
  return (
    <Edit.Provider value={ctx}>
      <div className="data-view">
        <Toolbar summary={summary} canUndo={canUndo} onUndo={undo} />
        <div className="dv-scroll">
          <div className="dv-doc">
            {node.type === "object" && node.entries.length === 0 ? (
              <p className="dv-muted">This object has no fields.</p>
            ) : (
              <JsonValue node={node} label="Value" depth={0} />
            )}
          </div>
        </div>
      </div>
    </Edit.Provider>
  );
}

// ---------- JSONL ----------

function JsonLinesView({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const lines = useMemo(() => parseJsonLines(source), [source]);
  const { emit, undo, canUndo } = useEdits(source, onChange);
  const ctx = useMemo(() => ({ source, emit }), [source, emit]);
  const [limit, setLimit] = useState(JSONL_PAGE);

  const records = useMemo(() => lines.filter((l) => l.status !== "blank"), [lines]);
  const blank = lines.length - records.length;
  const invalid = records.filter((l) => l.status === "error").length;
  const columns = useMemo(() => {
    const ok = records.flatMap((l) => (l.status === "ok" ? [l.node] : []));
    return ok.length > 1 ? tableColumns(ok) : null;
  }, [records]);
  const shown = records.slice(0, limit);
  const more = records.length - shown.length;
  const errorText = (e: JsonError) => `Not valid JSON: ${e.message} (column ${e.column})`;

  return (
    <Edit.Provider value={ctx}>
      <div className="data-view">
        <Toolbar
          summary={
            <>
              {plural(records.length - invalid, "record")}
              {invalid > 0 && <span className="dv-warn"> · {plural(invalid, "invalid line")}</span>}
              {blank > 0 && <span className="dv-muted"> · {plural(blank, "blank line")}</span>}
            </>
          }
          canUndo={canUndo}
          onUndo={undo}
        />
        <div className="dv-scroll">
          {columns ? (
            <div className="dv-doc wide">
              <RecordTable
                columns={columns}
                label="Line"
                records={shown.map((l) =>
                  l.status === "ok"
                    ? { key: String(l.line), label: String(l.line), node: l.node }
                    : {
                        key: String(l.line),
                        label: String(l.line),
                        error: l.status === "error" ? errorText(l.error) : "",
                        raw: source.slice(l.start, l.end),
                      },
                )}
              />
            </div>
          ) : (
            <div className="dv-doc">
              {shown.map((l) => (
                <section
                  key={l.line}
                  className={`dv-card${l.status === "error" ? " invalid" : ""}`}
                  aria-label={`Line ${l.line}`}
                >
                  <header className="dv-card-head">
                    <span>Line {l.line}</span>
                    {l.status === "ok" && <span className="dv-muted">{containerSummary(l.node)}</span>}
                  </header>
                  {l.status === "ok" ? (
                    <JsonValue node={l.node} label={`Line ${l.line}`} depth={1} />
                  ) : l.status === "error" ? (
                    <>
                      <p className="dv-error-text">{errorText(l.error)}</p>
                      <code className="dv-raw">{source.slice(l.start, l.end)}</code>
                    </>
                  ) : null}
                </section>
              ))}
            </div>
          )}
          {more > 0 && (
            <ShowMore remaining={more} step={JSONL_PAGE} noun="record" onClick={() => setLimit((l) => l + JSONL_PAGE)} />
          )}
        </div>
      </div>
    </Edit.Provider>
  );
}

// ---------- Entry ----------

/**
 * Structured view of a data file: CSV/TSV as an editable table, JSON as
 * labelled fields, JSONL as a list of records. Every edit is a splice into
 * `source` (see dataFormats.ts), handed to `onChange` like any other edit.
 * JSON that doesn't parse falls back to the read-only code view.
 *
 * Re-renders only when the text or path changes: callers tend to pass a fresh
 * `onChange` closure each render, and a big table shouldn't redraw for it.
 */
export const DataView = memo(function DataView({
  source,
  path,
  onChange,
}: {
  source: string;
  path: string;
  onChange: (next: string) => void;
}) {
  const format = dataFormatFor(path);
  const json = useMemo(() => (format === "json" ? parseJson(source) : null), [format, source]);

  if (format === "csv" || format === "tsv") {
    return <CsvView source={source} delimiter={format === "tsv" ? "\t" : ","} onChange={onChange} />;
  }
  if (format === "jsonl") return <JsonLinesView source={source} onChange={onChange} />;
  if (json?.ok) return <JsonDocument source={source} node={json.node} onChange={onChange} />;
  if (json && !json.ok) {
    const { line, column, message } = json.error;
    return (
      <div className="dv-fallback">
        <div className="dv-parse-error" role="status">
          <span>
            This JSON can’t be shown as fields: {message} at line {line}, column {column}.
          </span>
          <button
            type="button"
            className="dv-button"
            onClick={() => document.getElementById(`L${line}`)?.scrollIntoView({ block: "center" })}
          >
            Go to line {line}
          </button>
        </div>
        <CodeView source={source} path={path} />
      </div>
    );
  }
  return <CodeView source={source} path={path} />;
}, (a, b) => a.source === b.source && a.path === b.path);
