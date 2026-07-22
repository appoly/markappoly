import { describe, expect, it } from "vitest";
import { buildResolver, parseWikiTarget, stemOf, type FileIndex } from "./vault";

const file = (path: string, name: string, links: FileIndex["links"] = []): FileIndex => ({
  path,
  name,
  links,
  tags: [],
});

describe("parseWikiTarget", () => {
  it("splits file, anchor, and alias", () => {
    expect(parseWikiTarget("Note")).toEqual({ file: "Note", anchor: "", alias: "" });
    expect(parseWikiTarget("Note#Section|Label")).toEqual({
      file: "Note",
      anchor: "Section",
      alias: "Label",
    });
    expect(parseWikiTarget("#Heading")).toEqual({ file: "", anchor: "Heading", alias: "" });
  });
});

describe("stemOf", () => {
  it("lowercases the basename and drops the extension", () => {
    expect(stemOf("/vault/Projects/My Note.md")).toBe("my note");
    expect(stemOf("plain")).toBe("plain");
  });
});

describe("buildResolver", () => {
  const files = [
    file("/vault/Alpha.md", "Alpha.md"),
    file("/vault/deep/Beta.md", "deep/Beta.md"),
    file("/vault/other/Beta.md", "other/Beta.md"),
  ];
  const resolver = buildResolver(files, "/vault");

  it("resolves by basename regardless of folder", () => {
    expect(resolver.resolveWiki("Alpha")).toBe("/vault/Alpha.md");
    expect(resolver.resolveWiki("alpha")).toBe("/vault/Alpha.md");
  });

  it("prefers a note in the same folder when names collide", () => {
    expect(resolver.resolveWiki("Beta", "/vault/other")).toBe("/vault/other/Beta.md");
  });

  it("resolves path-qualified targets", () => {
    expect(resolver.resolveWiki("deep/Beta")).toBe("/vault/deep/Beta.md");
    expect(resolver.resolveWiki("other/Beta")).toBe("/vault/other/Beta.md");
  });

  it("ignores anchors and aliases while resolving", () => {
    expect(resolver.resolveWiki("Alpha#Intro|Displayed")).toBe("/vault/Alpha.md");
  });

  it("guesses a sibling path for unindexed targets", () => {
    expect(resolver.resolveWiki("Missing", "/vault/deep")).toBe("/vault/deep/Missing.md");
  });

  it("returns null for same-document anchors", () => {
    expect(resolver.resolveWiki("#Heading")).toBeNull();
  });
});

describe("backlinks and outgoing links", () => {
  const files = [
    file("/vault/A.md", "A.md", [
      { target: "B", line: 3, text: "See [[B]]", wiki: true },
      { target: "./C.md", line: 9, text: "Also [C](./C.md)", wiki: false },
    ]),
    file("/vault/B.md", "B.md", [{ target: "C", line: 1, text: "[[C]]", wiki: true }]),
    file("/vault/C.md", "C.md"),
  ];
  const resolver = buildResolver(files, "/vault");

  it("finds files linking to a note with context lines", () => {
    const back = resolver.backlinksFor("/vault/C.md");
    expect(back.map((b) => b.name).sort()).toEqual(["A.md", "B.md"]);
    const fromA = back.find((b) => b.name === "A.md")!;
    expect(fromA.contexts).toEqual([{ line: 9, text: "Also [C](./C.md)" }]);
  });

  it("lists outgoing resolved targets", () => {
    expect(resolver.outgoingFor("/vault/A.md").sort()).toEqual([
      "/vault/B.md",
      "/vault/C.md",
    ]);
  });

  it("counts tags across the vault", () => {
    const tagged = [
      { ...file("/vault/X.md", "X.md"), tags: ["work", "idea"] },
      { ...file("/vault/Y.md", "Y.md"), tags: ["work"] },
    ];
    const counts = buildResolver(tagged, "/vault").tagCounts();
    expect(counts.get("work")).toBe(2);
    expect(counts.get("idea")).toBe(1);
  });
});
