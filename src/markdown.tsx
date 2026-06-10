import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import type { PluggableList } from "unified";
import GithubSlugger from "github-slugger";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Mermaid } from "./Mermaid";
import "katex/dist/katex.min.css";

export type Heading = { depth: number; text: string; slug: string; line: number };

/** Extract headings (with github-slugger slugs matching rehype-slug) for the outline. */
export function extractHeadings(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;
  source.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].replace(/\s*#+\s*$/, "").trim();
      headings.push({ depth: m[1].length, text, slug: slugger.slug(text), line: i });
    }
  });
  return headings;
}

// Sanitize untrusted HTML embedded in the Markdown. This strips <script>, event
// handlers (onerror/onload/…), javascript: URLs, etc. KaTeX, syntax highlighting
// and heading slugs run AFTER this step, so their generated markup is trusted and
// preserved; only author-supplied raw HTML is filtered.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "input", // task-list checkboxes
    "details",
    "summary",
    "kbd",
    "mark",
    "section",
    "figure",
    "figcaption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    // className is safe (cannot execute) and is needed so the math/code markers
    // survive to the KaTeX/highlight steps that run after sanitization.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    input: ["type", "checked", "disabled"],
  },
};

// GitHub-style alerts: turn `> [!NOTE]` (and TIP/IMPORTANT/WARNING/CAUTION)
// blockquotes into labelled, coloured admonitions. Implemented as a small mdast
// transform so its output (a plain blockquote with class names) survives the
// sanitize step without needing to allow <svg> or <div>.
const ALERT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*\r?\n?/i;
function remarkAlerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (bq: any) => {
    const para = bq.children?.[0];
    if (!para || para.type !== "paragraph" || !Array.isArray(para.children)) return;
    const first = para.children[0];
    if (!first || first.type !== "text") return;
    const m = ALERT_RE.exec(first.value);
    if (!m) return;
    const type = m[1].toLowerCase();
    first.value = first.value.slice(m[0].length);
    if (first.value === "") {
      para.children.shift();
      if (para.children[0]?.type === "break") para.children.shift();
    }
    bq.data = {
      ...(bq.data || {}),
      hName: "blockquote",
      hProperties: { className: ["markdown-alert", `markdown-alert-${type}`] },
    };
    bq.children.unshift({
      type: "paragraph",
      data: { hProperties: { className: ["markdown-alert-title"] } },
      children: [{ type: "text", value: type.charAt(0).toUpperCase() + type.slice(1) }],
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === "blockquote") apply(child);
      walk(child);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => walk(tree);
}

const remarkPlugins = [remarkGfm, remarkMath, remarkFrontmatter, remarkAlerts];
const rehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
  rehypeHighlight,
];

// Only open links with safe schemes externally; ignore file:, javascript:, etc.
const SAFE_LINK = /^(https?:|mailto:)/i;
const REMOTE_SRC = /^(https?:|data:|blob:|asset:)/i;

// Resolve a Markdown image src so local files render in the webview. Remote and
// data URLs pass through; relative paths resolve against the document's folder
// and go through Tauri's asset protocol.
function resolveImageSrc(src: string, basePath?: string): string {
  if (!src || REMOTE_SRC.test(src)) return src;
  const isAbsolute = src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src);
  let filePath = src.replace(/^file:\/\//, "");
  if (!isAbsolute && basePath) {
    filePath = basePath.replace(/[\\/]+$/, "") + "/" + src;
  }
  try {
    return convertFileSrc(filePath);
  } catch {
    return src;
  }
}

type PreviewProps = {
  source: string;
  dark: boolean;
  onToggleTask: (index: number) => void;
  basePath?: string;
};

export function Preview({ source, dark, onToggleTask, basePath }: PreviewProps) {
  // Task checkboxes render in document order; track their index to map back to source.
  let taskIndex = -1;

  const components: Components = {
    code({ node: _node, className, children, ...rest }) {
      if (className === "language-mermaid") {
        return <Mermaid code={String(children).replace(/\n$/, "")} dark={dark} />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    img({ node: _node, src, alt, ...rest }) {
      return (
        <img src={resolveImageSrc(typeof src === "string" ? src : "", basePath)} alt={alt} {...rest} />
      );
    },
    input({ node: _node, ...props }) {
      if (props.type === "checkbox") {
        taskIndex += 1;
        const idx = taskIndex;
        return (
          <input
            type="checkbox"
            checked={!!props.checked}
            onChange={() => onToggleTask(idx)}
          />
        );
      }
      return <input {...props} />;
    },
    a({ node: _node, href, children, ...rest }) {
      const url = href ?? "";
      return (
        <a
          href={url}
          onClick={(e) => {
            e.preventDefault();
            if (url.startsWith("#")) {
              document
                .getElementById(url.slice(1))
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            } else if (SAFE_LINK.test(url)) {
              openUrl(url).catch(() => {});
            }
          }}
          {...rest}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
}
