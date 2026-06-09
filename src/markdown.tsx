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

const remarkPlugins = [remarkGfm, remarkMath, remarkFrontmatter];
const rehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
  rehypeHighlight,
];

// Only open links with safe schemes externally; ignore file:, javascript:, etc.
const SAFE_LINK = /^(https?:|mailto:)/i;

type PreviewProps = {
  source: string;
  dark: boolean;
  onToggleTask: (index: number) => void;
};

export function Preview({ source, dark, onToggleTask }: PreviewProps) {
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
