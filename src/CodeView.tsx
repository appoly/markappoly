import { memo, useMemo } from "react";
import hljs from "highlight.js/lib/common";

const ALIASES: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  toml: "ini",
  kt: "kotlin",
  cs: "csharp",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  ps1: "powershell",
  bat: "dos",
  cmd: "dos",
  vue: "xml",
  svelte: "xml",
  html: "xml",
};
const MAX_HIGHLIGHT = 512 * 1024;

function languageFor(path: string | null): string | null {
  const name = (path ?? "").split(/[\\/]/).pop() ?? "";
  if (/^(Makefile|GNUmakefile)$/.test(name)) return "makefile";
  if (/^Dockerfile/.test(name)) return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const lang = ALIASES[ext] ?? ext;
  return lang && hljs.getLanguage(lang) ? lang : null;
}

/**
 * highlight.js returns one HTML string whose spans can cross line breaks.
 * Split it into per-line HTML, closing open spans at each line end and
 * reopening them on the next line, so every row stays well-formed.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const re = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tok = m[0];
    if (tok === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else if (tok.startsWith("<span")) {
      open.push(tok);
      current += tok;
    } else if (tok === "</span>") {
      open.pop();
      current += tok;
    } else {
      current += tok;
    }
  }
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Read-only view of a source or text file opened from a link: highlighted,
 * with line numbers. Each row carries data-source-line, so `#L42` anchors and
 * the app's line targeting scroll straight to it.
 */
export const CodeView = memo(function CodeView({
  source,
  path,
}: {
  source: string;
  path: string | null;
}) {
  const rows = useMemo(() => {
    const lang = languageFor(path);
    const text = source.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (!lang || text.length > MAX_HIGHLIGHT) return text.split("\n").map(escape);
    try {
      return splitHighlightedLines(hljs.highlight(text, { language: lang }).value);
    } catch {
      return text.split("\n").map(escape);
    }
  }, [source, path]);

  return (
    <div className="code-view" role="document">
      <pre className="hljs">
        <code>
          {rows.map((html, i) => (
            <div className="code-line" key={i} id={`L${i + 1}`} data-source-line={i + 1}>
              <span className="code-ln" aria-hidden>
                {i + 1}
              </span>
              {/* highlight.js output (or escaped text): never raw file HTML. */}
              <span className="code-text" dangerouslySetInnerHTML={{ __html: html || " " }} />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
});
