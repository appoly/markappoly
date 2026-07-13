import { describe, expect, it } from "vitest";
import { buildFolderTree } from "./folderTree";

describe("buildFolderTree", () => {
  it("builds a nested tree from relative paths", () => {
    const tree = buildFolderTree([
      { name: "readme.md", path: "/p/readme.md" },
      { name: "docs/a.md", path: "/p/docs/a.md" },
      { name: "docs/b.md", path: "/p/docs/b.md" },
      { name: "docs/deep/c.md", path: "/p/docs/deep/c.md" },
    ]);

    expect(tree).toHaveLength(2);
    const docs = tree.find((n) => n.kind === "dir" && n.name === "docs");
    const readme = tree.find((n) => n.kind === "file" && n.name === "readme.md");
    expect(readme).toMatchObject({ path: "/p/readme.md" });
    expect(docs?.kind).toBe("dir");
    if (docs?.kind === "dir") {
      expect(docs.children.some((c) => c.kind === "file" && c.name === "a.md")).toBe(true);
      const deep = docs.children.find((c) => c.kind === "dir" && c.name === "deep");
      expect(deep?.kind).toBe("dir");
      if (deep?.kind === "dir") {
        expect(deep.children).toEqual([
          { kind: "file", name: "c.md", path: "/p/docs/deep/c.md" },
        ]);
      }
    }
  });

  it("returns empty for empty input", () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});
