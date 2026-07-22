import GithubSlugger from "github-slugger";
import { parseWikiTarget } from "./vault";

/**
 * Obsidian-flavoured inline syntax, handled in one pass over text nodes:
 *
 * - `[[Note]]`, `[[Note#Heading|Alias]]` → links resolved through the vault index
 * - `![[Note]]` / `![[image.png]]`       → embedded notes and images
 * - `#tag`                               → clickable tag chips
 * - `==text==`                           → <mark> highlights
 * - `%%comment%%`                        → stripped from the preview
 */
export type ObsidianOptions = {
  /** Resolve a wiki target to an absolute path (null = unresolved). */
  resolveWiki?: (target: string) => string | null;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const TOKEN_RE =
  /%%[\s\S]*?%%|(!?)\[\[([^\][\n]+)\]\]|==([^=\n]+)==|(^|[\s([{>])#([A-Za-z0-9_/-]+)/g;

/* eslint-disable @typescript-eslint/no-explicit-any */

function textNode(value: string): any {
  return { type: "text", value };
}

function wikiLinkNode(raw: string, resolve?: (t: string) => string | null): any {
  const { file, anchor, alias } = parseWikiTarget(raw);
  const display = alias || (anchor && !file ? anchor : raw.split("|")[0]);

  if (!file && anchor) {
    // Same-document heading link: [[#Heading]]
    return {
      type: "link",
      url: `#${new GithubSlugger().slug(anchor)}`,
      data: { hProperties: { className: ["wiki-link"] } },
      children: [textNode(display)],
    };
  }

  const resolved = resolve?.(raw) ?? null;
  return {
    type: "link",
    url: resolved ?? "#",
    data: {
      hProperties: {
        className: resolved ? ["wiki-link"] : ["wiki-link", "wiki-unresolved"],
        // Sanitization drops hrefs whose leading `C:` parses as an unknown URL
        // scheme (Windows paths); the data attribute survives and the link
        // handler falls back to it.
        ...(resolved ? { dataWikiTarget: resolved } : {}),
      },
    },
    children: [textNode(display)],
  };
}

function embedNode(raw: string, resolve?: (t: string) => string | null): any {
  const { file, anchor, alias } = parseWikiTarget(raw);
  if (IMAGE_EXT_RE.test(file)) {
    return { type: "image", url: file, alt: alias || "" };
  }
  const resolved = resolve?.(raw) ?? null;
  if (!resolved) return wikiLinkNode(raw, resolve);
  return {
    type: "wikiEmbed",
    data: {
      hName: "span",
      hProperties: {
        className: ["wiki-embed"],
        dataEmbedTarget: resolved,
        dataEmbedAnchor: anchor,
        dataEmbedLabel: alias || file,
      },
    },
    children: [],
  };
}

function tagNode(tag: string): any {
  return {
    type: "wikiTag",
    data: {
      hName: "span",
      hProperties: { className: ["md-tag"], dataTag: tag },
    },
    children: [textNode(`#${tag}`)],
  };
}

function highlightNode(inner: string): any {
  return { type: "wikiHighlight", data: { hName: "mark" }, children: [textNode(inner)] };
}

function splitTextNode(value: string, opts: ObsidianOptions): any[] | null {
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  const out: any[] = [];
  while ((m = TOKEN_RE.exec(value)) !== null) {
    const [full, embedBang, wikiTarget, highlightInner, tagPrefix, tagName] = m;

    if (tagName !== undefined && !/[^0-9]/.test(tagName)) continue; // "#123" is not a tag

    if (m.index > last) out.push(textNode(value.slice(last, m.index)));
    last = m.index + full.length;

    if (full.startsWith("%%")) {
      // Comment: contribute nothing.
    } else if (wikiTarget !== undefined) {
      out.push(
        embedBang === "!"
          ? embedNode(wikiTarget, opts.resolveWiki)
          : wikiLinkNode(wikiTarget, opts.resolveWiki),
      );
    } else if (highlightInner !== undefined) {
      out.push(highlightNode(highlightInner));
    } else if (tagName !== undefined) {
      if (tagPrefix) out.push(textNode(tagPrefix));
      out.push(tagNode(tagName));
    }
  }
  if (out.length === 0 && last === 0) return null; // nothing matched
  if (last < value.length) out.push(textNode(value.slice(last)));
  return out;
}

const SKIP_PARENTS = new Set(["link", "linkReference", "code", "inlineCode", "math", "inlineMath"]);

export function remarkObsidian(options: ObsidianOptions = {}) {
  const walk = (node: any) => {
    if (!node || !Array.isArray(node.children) || SKIP_PARENTS.has(node.type)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === "text") {
        const replacement = splitTextNode(child.value, options);
        if (replacement) {
          node.children.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        }
      } else {
        walk(child);
      }
    }
  };
  return (tree: any) => walk(tree);
}
