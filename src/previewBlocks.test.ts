import { describe, expect, it } from "vitest";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import Markdown from "react-markdown";
import { createElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { PluggableList } from "unified";
import type { Root, RootContent } from "hast";
import { rehypeSourceLines, remarkPluginsFor, sanitizeSchema } from "./renderPipeline";
import {
  assignSlugs,
  cachedBlock,
  createBlockProcessor,
  joinBlocks,
  prepareBlock,
  splitBlocks,
  stampBlock,
} from "./previewBlocks";

const resolveWiki = (t: string) => (t.startsWith("Missing") ? null : `/vault/${t}.md`);

/** Whitespace between top-level blocks doesn't render; compare without it. */
const isRootWhitespace = (n: RootContent) => n.type === "text" && !n.value.trim();
const dropRootWhitespace = () => (tree: Root) => {
  tree.children = tree.children.filter((n) => !isRootWhitespace(n));
};

/** The whole-document react-markdown render the preview used before blocks. */
const wholePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
  rehypeHighlight,
  rehypeSourceLines,
  dropRootWhitespace,
];
const remarkPlugins = remarkPluginsFor(resolveWiki);
const blockProcessor = createBlockProcessor(remarkPlugins);

const wholeHtml = (source: string) =>
  renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins, rehypePlugins: wholePlugins }, source),
  );

function blockHtml(source: string) {
  const parts = splitBlocks(source);
  const prepared = parts.map((p) => prepareBlock(blockProcessor, p.text));
  assignSlugs(prepared).forEach((ids, i) => stampBlock(prepared[i], ids, `b${i}`));
  const tree = joinBlocks(prepared, parts.map((p) => p.line));
  dropRootWhitespace()(tree);
  return renderToStaticMarkup(
    toJsxRuntime(tree, { Fragment, jsx, jsxs, ignoreInvalidStyle: true, passKeys: true }),
  );
}

function expectParity(source: string) {
  expect(blockHtml(source)).toBe(wholeHtml(source));
}

const CASES: Record<string, string> = {
  "frontmatter and headings": "---\ntitle: T\ntags: [a]\n---\n\n# Title\n\nIntro.\n\n## Part\n\nBody.",
  "duplicate headings across blocks": "## Setup\n\nOne.\n\n## Setup\n\nTwo.\n\n### Setup\n\n## Setup {#x}\n\nThree.",
  "loose and ordered lists": "1. one\n\n2. two\n\n   continued paragraph\n\n3. three\n\nAfter.\n\n- a\n\n- b\n  - nested\n\n- c",
  "list then paragraph": "- item\n- item\n\nParagraph.\n\n* other list",
  "fences with blank lines": "Text.\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\n~~~~\n```\n\nstill code\n~~~~\n\nEnd.",
  "math blocks": "Inline $x^2$.\n\n$$\na = b\n\nc = d\n$$\n\n$$x$$\n\nAfter $y$.",
  "html containers with blank lines": "<details><summary>More</summary>\n\nHidden **content**.\n\n- list\n\n</details>\n\n<div>\n\nInside div.\n\n</div>\n\nOutside.",
  "html comment spanning blocks": "Before.\n\n<!-- a comment\n\nstill comment -->\n\nAfter.",
  "inline code mentioning tags": "Use `<div>` here.\n\nNext paragraph.\n\n## Heading",
  "thematic breaks": "Para.\n\n---\n\nMiddle\n\n---\n\nEnd.\n\n***\n\nDone.",
  "callouts and quotes": "> [!NOTE] Title\n> Body.\n\n> [!tip]- Folded\n> Hidden.\n\n> plain\n\n> second quote",
  "tables and tasks": "| a | b |\n|---|:-:|\n| 1 | **2** |\n\n- [ ] todo\n- [x] done\n\nText.",
  "indented code": "Para.\n\n    indented code\n\n    more\n\nAfter.",
  "obsidian syntax": "See [[Note#Heading|alias]] and [[Missing]], #tag and ==mark==.\n\n![[Embedded]]\n\n%%hidden%% visible",
  "footnotes fall back to one block": "Text[^1].\n\n## Head\n\nMore.\n\n[^1]: The note.",
  "reference links fall back to one block": "A [link][ref].\n\nMore.\n\n[ref]: https://example.com",
  "unsafe urls": "[x](javascript:alert(1))\n\n<a href=\"javascript:alert(2)\">y</a>\n\n![img](data:image/png;base64,AAA)",
  "leading and trailing blank lines": "\n\n\n# Start\n\n\n\nText.\n\n\n",
  "empty": "",
};

describe("block rendering matches whole-document rendering", () => {
  for (const [name, source] of Object.entries(CASES)) {
    it(name, () => expectParity(source));
  }

  it("a large mixed document", () => {
    const sections: string[] = ["---", "title: Big", "---", ""];
    for (let i = 0; i < 30; i++) {
      sections.push(
        `## Section ${i % 7}`,
        "",
        `Para ${i} with *em*, \`code\`, [[Note ${i}]], #t${i % 3} and $e^{i}$.`,
        "",
        "- [ ] a",
        "- [x] b",
        "",
        i % 3 === 0 ? "```js\nlet x = 1;\n\nx++;\n```\n" : "| a |\n|---|\n| 1 |\n",
        i % 4 === 0 ? "> [!WARNING]\n> Careful.\n" : "$$\n\\sum_i i\n$$\n",
      );
    }
    expectParity(sections.join("\n"));
  });
});

describe("cachedBlock", () => {
  it("shares parsed blocks across lookups and drops the least recently used", () => {
    const first = cachedBlock(blockProcessor, "Shared *block*.");
    expect(cachedBlock(blockProcessor, "Shared *block*.")).toBe(first);
    const big = (c: string) => c.repeat(250_000);
    const a = cachedBlock(blockProcessor, big("a"));
    cachedBlock(blockProcessor, big("b"));
    expect(cachedBlock(blockProcessor, big("a"))).not.toBe(a);
  });
});

describe("splitBlocks", () => {
  it("splits independent paragraphs and keeps their start lines", () => {
    expect(splitBlocks("# A\n\nOne\ntwo\n\n\nThree")).toEqual([
      { text: "# A", line: 0 },
      { text: "One\ntwo", line: 2 },
      { text: "Three", line: 6 },
    ]);
  });

  it("keeps a list with blank lines between items together", () => {
    expect(splitBlocks("- a\n\n- b\n\n  more\n\nAfter").map((b) => b.text)).toEqual([
      "- a\n\n- b\n\n  more",
      "After",
    ]);
  });

  it("never starts a block on a frontmatter-like rule", () => {
    expect(splitBlocks("Para\n\n---\nx: y\n---").length).toBe(1);
  });
});
