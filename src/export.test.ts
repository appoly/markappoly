import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  findMissingImages,
  htmlDocument,
  imageMime,
  localImagePath,
  markdownToDocxBase64,
  markdownToHtml,
  type ExportContext,
} from "./export";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** An in-memory filesystem standing in for the Tauri commands. */
function fakeFs(files: Record<string, string>): ExportContext {
  return {
    readText: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    readBase64: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
  };
}

describe("localImagePath", () => {
  it("resolves relative references against the document folder", () => {
    expect(localImagePath("assets/a.png", "/docs/notes")).toBe("/docs/notes/assets/a.png");
    expect(localImagePath("./a.png", "/docs")).toBe("/docs/a.png");
    expect(localImagePath("../img/a.png", "/docs/notes")).toBe("/docs/img/a.png");
  });

  it("decodes percent-encoding and drops query/hash suffixes", () => {
    expect(localImagePath("my%20pic.png?v=2", "/d")).toBe("/d/my pic.png");
    expect(localImagePath("a.png#frag", "/d")).toBe("/d/a.png");
  });

  it("keeps absolute paths and unwraps file:// URLs", () => {
    expect(localImagePath("/abs/a.png", "/d")).toBe("/abs/a.png");
    expect(localImagePath("file:///abs/a.png")).toBe("/abs/a.png");
    expect(localImagePath("file:///C:/pics/a.png")).toBe("C:/pics/a.png");
    expect(localImagePath("C:\\pics\\a.png")).toBe("C:\\pics\\a.png");
  });

  it("ignores web URLs, data URIs and unanchored relatives", () => {
    expect(localImagePath("https://x.test/a.png", "/d")).toBeNull();
    expect(localImagePath("data:image/png;base64,AAA", "/d")).toBeNull();
    expect(localImagePath("a.png")).toBeNull();
    expect(localImagePath("")).toBeNull();
  });
});

describe("imageMime", () => {
  it("maps common extensions", () => {
    expect(imageMime("/a/b.PNG")).toBe("image/png");
    expect(imageMime("x.jpeg")).toBe("image/jpeg");
    expect(imageMime("x.svg")).toBe("image/svg+xml");
    expect(imageMime("x.unknown")).toBe("application/octet-stream");
  });
});

describe("markdownToHtml (preview-equivalent pipeline)", () => {
  it("renders callouts, highlights, tags and hides comments", async () => {
    const html = await markdownToHtml(
      "> [!WARNING] Careful\n> Body\n\n==bright== and #topic %%secret%%\n",
    );
    expect(html).toContain('class="markdown-alert markdown-alert-warning"');
    expect(html).toContain("Careful");
    expect(html).toContain("<mark>bright</mark>");
    expect(html).toContain('class="md-tag"');
    expect(html).not.toContain("secret");
  });

  it("renders foldable callouts as details/summary", async () => {
    const html = await markdownToHtml("> [!tip]- Hidden\n> inside\n");
    expect(html).toMatch(/<details class="markdown-alert markdown-alert-tip">/);
    expect(html).toContain("<summary");
  });

  it("drops frontmatter and renders math as MathML", async () => {
    const html = await markdownToHtml("---\ntitle: X\n---\n\nInline $a^2$\n");
    expect(html).not.toContain("title: X");
    expect(html).toContain("<math");
  });

  it("turns wiki links into text without leaking local paths", async () => {
    const html = await markdownToHtml("See [[Other]] and [[Missing]]", {
      resolveWiki: (t) => (t === "Other" ? "/Users/me/vault/Other.md" : null),
    });
    expect(html).toContain('<span class="wiki-link">Other</span>');
    expect(html).not.toContain("/Users/me");
  });

  it("still sanitizes author HTML", async () => {
    const html = await markdownToHtml('<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });

  it("inlines local images as data URIs", async () => {
    const html = await markdownToHtml("![dot](img/dot.png)", {
      baseDir: "/docs",
      ...fakeFs({ "/docs/img/dot.png": PNG_B64 }),
    });
    expect(html).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    expect(html).not.toContain("export-img-");
  });

  it("keeps the reference when an image is missing", async () => {
    const html = await markdownToHtml("![gone](gone.png)", { baseDir: "/docs", ...fakeFs({}) });
    expect(html).toContain('src="gone.png"');
  });

  it("does not let author data: images through sanitization", async () => {
    const html = await markdownToHtml(`<img src="data:image/png;base64,${PNG_B64}">`);
    expect(html).not.toContain("data:image");
  });

  it("replaces mermaid blocks with the rendered SVG", async () => {
    const html = await markdownToHtml("```mermaid\ngraph TD; A-->B\n```\n", {
      renderMermaid: async () => '<svg id="d"><text>A</text></svg>',
    });
    expect(html).toContain('<div class="mermaid-diagram"><svg id="d">');
    expect(html).not.toContain("graph TD");
  });

  it("falls back to the code block when a diagram fails", async () => {
    const html = await markdownToHtml("```mermaid\nnope\n```\n", {
      renderMermaid: async () => {
        throw new Error("parse error");
      },
    });
    expect(html).toContain("nope");
  });

  it("inlines embedded notes, sections, and their images", async () => {
    const ctx: ExportContext = {
      baseDir: "/v",
      resolveWiki: (t) => (t.startsWith("Child") ? "/v/sub/Child.md" : null),
      ...fakeFs({
        "/v/sub/Child.md": "# Intro\n\nskip me\n\n## Part\n\nkeep me ![p](p.png)\n",
        "/v/sub/p.png": PNG_B64,
      }),
    };
    const html = await markdownToHtml("![[Child#Part]]\n", ctx);
    expect(html).toContain('class="embed-note"');
    expect(html).toContain("keep me");
    expect(html).not.toContain("skip me");
    // The embed's relative image resolved against the embed's own folder.
    expect(html).toContain("data:image/png;base64,");
  });

  it("stops recursive embeds", async () => {
    const ctx: ExportContext = {
      resolveWiki: () => "/v/Loop.md",
      ...fakeFs({ "/v/Loop.md": "loop ![[Loop]]\n\n![[Loop]]\n" }),
    };
    const html = await markdownToHtml("![[Loop]]\n", ctx);
    expect(html.match(/class="embed-note"/g)?.length ?? 0).toBeLessThanOrEqual(3);
  });
});

describe("htmlDocument", () => {
  it("is a standalone page with light and dark styles", () => {
    const doc = htmlDocument("A <b>", "<p>x</p>");
    expect(doc).toContain("<title>A &lt;b&gt;</title>");
    expect(doc).toContain("prefers-color-scheme: dark");
    expect(doc).toContain('<article class="markdown-body">');
    expect(doc).not.toMatch(/<link|<script/);
  });
});

describe("findMissingImages", () => {
  it("reports local images that do not exist, once each", async () => {
    const present = new Set(["/d/ok.png"]);
    const missing = await findMissingImages(
      "![a](ok.png) ![b](gone.png) ![c](gone.png) ![d](https://x.test/r.png) ![[pic.png]]",
      { baseDir: "/d" },
      async (p) => present.has(p),
    );
    expect(missing).toEqual(["gone.png", "pic.png"]);
  });
});

describe("markdownToDocxBase64", () => {
  async function documentXml(md: string, ctx: ExportContext = {}): Promise<string> {
    const b64 = await markdownToDocxBase64(md, ctx);
    const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
    return zip.file("word/document.xml")!.async("string");
  }

  it("carries highlights, callout labels and tags", async () => {
    const xml = await documentXml("> [!WARNING] Mind\n> body\n\n==lit== #tag\n");
    expect(xml).toContain('w:val="yellow"'); // highlight run
    expect(xml).toContain("Mind");
    expect(xml).toMatch(/w:color w:val="9A6700"/);
    expect(xml).toContain("#tag");
  });

  it("embeds local images resolved against the document folder", async () => {
    const b64 = await markdownToDocxBase64("![dot](dot.png)", {
      baseDir: "/docs",
      ...fakeFs({ "/docs/dot.png": PNG_B64 }),
    });
    const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
    expect(Object.keys(zip.files).some((f) => /^word\/media\/.+\.png$/.test(f))).toBe(true);
  });

  it("renders math to Word equations", async () => {
    const xml = await documentXml("$$\na^2\n$$\n");
    expect(xml).toContain("m:oMath");
  });

  it("drops frontmatter", async () => {
    const xml = await documentXml("---\ntitle: Secret\n---\n\nBody\n");
    expect(xml).not.toContain("Secret");
    expect(xml).toContain("Body");
  });
});
