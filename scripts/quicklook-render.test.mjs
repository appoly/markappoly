// Runs the Quick Look renderer the way the extension does: marked's UMD build
// and quicklook/render.js evaluated as plain scripts in one global context.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadRenderer() {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(path.join(root, "node_modules/marked/lib/marked.umd.js"), "utf8"),
    context,
  );
  vm.runInContext(fs.readFileSync(path.join(root, "quicklook/render.js"), "utf8"), context);
  return context.markappolyRender;
}

describe("Quick Look renderer", () => {
  const render = loadRenderer();

  it("renders GFM tables, task lists and code", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n```js\n1 < 2\n```\n");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("1 &lt; 2");
  });

  it("shows frontmatter as a header instead of a stray rule", () => {
    const html = render("---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n");
    expect(html).toContain('<div class="fm-title">Hello</div>');
    expect(html).toContain("a, b");
    expect(html).not.toContain("<hr>");
  });

  it("turns GitHub alerts into styled callouts", () => {
    const html = render("> [!WARNING]\n> Careful\n");
    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain("Careful");
  });

  it("shows wiki-link labels and hides %%comments%%", () => {
    const html = render("See [[Note|the note]] %%secret%%\n");
    expect(html).toContain('<span class="wikilink">the note</span>');
    expect(html).not.toContain("secret");
  });

  it("drops active HTML and local images", () => {
    const html = render('<script>alert(1)</script>\n\n<iframe src="x"></iframe>\n\n![pic](assets/a.png)\n');
    expect(html).not.toMatch(/<script|<iframe/i);
    expect(html).not.toContain("<img");
    expect(html).toContain('<span class="img-placeholder">pic</span>');
  });
});
