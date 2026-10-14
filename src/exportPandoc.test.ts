import { describe, expect, it } from "vitest";
import { markdownForPandoc } from "./export";

const doc = [
  "---",
  "title: Launch plan",
  "author: Ops",
  "---",
  "",
  "# Plan",
  "",
  "This is ==very important== for #release, see [[Runbook]].",
  "",
  "> [!warning] Mind the gap",
  "> Deploys freeze on Friday.",
  "",
  "- [ ] write notes",
  "- [x] tag",
  "",
  "Euler: $e^{i\\pi} + 1 = 0$",
  "",
  "%%private note%%",
  "",
  "![[Appendix]]",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
  "",
].join("\n");

describe("markdownForPandoc", () => {
  it("rewrites preview-only syntax into Markdown Pandoc understands", async () => {
    const { markdown, files } = await markdownForPandoc(doc, {
      baseDir: "/notes",
      resolveWiki: (t) => `/notes/${t.split("#")[0]}.md`,
      readText: async () => "Appendix body.",
      renderMermaid: async () => "<svg xmlns='http://www.w3.org/2000/svg'/>",
      rasterizeSvg: async () => "UE5H",
    });
    expect(markdown.startsWith("---\ntitle: Launch plan\nauthor: Ops\n---\n")).toBe(true);
    expect(markdown).toContain("[very important]{.mark}");
    expect(markdown).toContain("#release");
    expect(markdown).toContain("see Runbook.");
    expect(markdown).not.toContain("[[");
    expect(markdown).toContain("> **Mind the gap**");
    expect(markdown).toContain("- [ ] write notes");
    expect(markdown).toContain("$e^{i\\pi} + 1 = 0$");
    expect(markdown).not.toContain("private note");
    expect(markdown).toContain("Appendix body.");
    expect(markdown).toContain("![Diagram](markappoly-diagram-1.png)");
    expect(files).toEqual([{ name: "markappoly-diagram-1.png", base64: "UE5H" }]);
  });

  it("drops frontmatter that isn't valid YAML instead of breaking Pandoc", async () => {
    const { markdown } = await markdownForPandoc("---\ntitle: [oops\n---\n\nBody\n");
    expect(markdown.trim()).toBe("Body");
  });
});
