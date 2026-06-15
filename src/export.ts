import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDocx from "remark-docx";

/**
 * Render Markdown to an HTML fragment (GitHub-flavored).
 *
 * Sanitized: this output feeds both the .html export and Copy-as-HTML, so it
 * can end up opened in a browser or pasted into another app. remark-rehype
 * already drops author raw HTML (no allowDangerousHtml), and rehype-sanitize
 * additionally strips dangerous URL schemes (javascript:, data:) from links
 * and images that would otherwise survive into the exported document.
 */
export function markdownToHtml(md: string): string {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .processSync(md)
    .toString();
}

/** Parse Markdown to its mdast syntax tree — used for the JSON export. */
export function markdownToAst(md: string): unknown {
  return unified().use(remarkParse).use(remarkGfm).parse(md);
}

/** Render Markdown to a .docx file, returned as a base64 string for binary writing. */
export async function markdownToDocxBase64(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDocx)
    .process(md);

  // remark-docx exposes the compiled document on `file.result`.
  const result = (file as unknown as { result: ArrayBuffer | Blob }).result;
  const buffer =
    result instanceof Blob ? await result.arrayBuffer() : await result;
  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Wrap an HTML fragment in a self-contained, styled document for export. */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         color: #1f2328; max-width: 820px; margin: 40px auto; padding: 0 24px; }
  h1, h2 { border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; }
  code { background: #eff1f3; padding: .2em .4em; border-radius: 6px; font-size: 85%; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { color: #59636e; border-left: .25em solid #d1d9e0; margin: 0; padding: 0 1em; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d1d9e0; padding: 6px 13px; }
  img { max-width: 100%; }
  a { color: #0969da; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
