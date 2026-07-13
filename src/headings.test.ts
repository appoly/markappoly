import { describe, expect, it } from "vitest";
import { extractHeadings } from "./headings";

describe("extractHeadings", () => {
  it("extracts ATX headings with slugs", () => {
    const src = `# Hello World\n\n## Nested\n\n### Third`;
    const hs = extractHeadings(src);
    expect(hs.map((h) => h.text)).toEqual(["Hello World", "Nested", "Third"]);
    expect(hs[0].depth).toBe(1);
    expect(hs[0].slug).toBe("hello-world");
    expect(hs[1].line).toBe(2);
  });

  it("skips headings inside fenced code", () => {
    const src = "```\n# not a heading\n```\n# Real";
    const hs = extractHeadings(src);
    expect(hs).toHaveLength(1);
    expect(hs[0].text).toBe("Real");
  });

  it("skips YAML frontmatter content", () => {
    const src = `---
title: X
# not a heading
---
# Real heading
`;
    const hs = extractHeadings(src);
    expect(hs).toHaveLength(1);
    expect(hs[0].text).toBe("Real heading");
  });
});
