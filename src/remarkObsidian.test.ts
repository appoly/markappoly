import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { remarkObsidian, type ObsidianOptions } from "./remarkObsidian";

function render(md: string, opts: ObsidianOptions = {}): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkObsidian, opts)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(md),
  );
}

const resolveWiki = (target: string) =>
  target.toLowerCase().startsWith("known") ? "/vault/Known.md" : null;

describe("remarkObsidian", () => {
  it("resolves wiki links through the resolver", () => {
    const html = render("See [[Known]] for more.", { resolveWiki });
    expect(html).toContain('href="/vault/Known.md"');
    expect(html).toContain("wiki-link");
    expect(html).toContain(">Known</a>");
  });

  it("marks unresolved wiki links", () => {
    const html = render("See [[Mystery]].", { resolveWiki });
    expect(html).toContain("wiki-unresolved");
  });

  it("uses the alias as display text", () => {
    const html = render("[[Known|the docs]]", { resolveWiki });
    expect(html).toContain(">the docs</a>");
  });

  it("links same-document headings", () => {
    const html = render("Jump to [[#My Section]].");
    expect(html).toContain('href="#my-section"');
  });

  it("turns embeds into markers and image embeds into images", () => {
    const html = render("![[Known]]\n\n![[shot.png]]", { resolveWiki });
    expect(html).toContain('data-embed-target="/vault/Known.md"');
    expect(html).toContain('<img src="shot.png"');
  });

  it("renders tags as clickable chips", () => {
    const html = render("Tagged #work/projects here.");
    expect(html).toContain("md-tag");
    expect(html).toContain('data-tag="work/projects"');
    expect(html).toContain("#work/projects");
  });

  it("does not treat issue numbers as tags", () => {
    expect(render("Fixed in #123.")).not.toContain("md-tag");
  });

  it("converts ==text== to mark", () => {
    expect(render("this is ==important== stuff")).toContain("<mark>important</mark>");
  });

  it("strips %%comments%%", () => {
    const html = render("visible %%hidden note%% end");
    expect(html).not.toContain("hidden note");
    expect(html).toContain("visible");
    expect(html).toContain("end");
  });

  it("leaves code spans alone", () => {
    const html = render("`[[NotALink]]` and `#nottag`");
    expect(html).toContain("[[NotALink]]");
    expect(html).not.toContain("wiki-link");
    expect(html).not.toContain("md-tag");
  });
});
