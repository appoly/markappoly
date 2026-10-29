import { describe, expect, it } from "vitest";
import { buildFolderTree, movedPath } from "./folderTree";

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

  it("gives folders their relative path", () => {
    const tree = buildFolderTree([{ name: "a/b/c.md", path: "/p/a/b/c.md" }]);
    expect(tree[0]).toMatchObject({ kind: "dir", rel: "a" });
    if (tree[0].kind === "dir") expect(tree[0].children[0]).toMatchObject({ rel: "a/b" });
  });

  it("sorts by last edit, folders by their newest file", () => {
    const tree = buildFolderTree(
      [
        { name: "old.md", path: "/p/old.md", mtime: 1 },
        { name: "new.md", path: "/p/new.md", mtime: 9 },
        { name: "a/x.md", path: "/p/a/x.md", mtime: 2 },
        { name: "b/y.md", path: "/p/b/y.md", mtime: 5 },
      ],
      "modified",
    );
    expect(tree.map((n) => n.name)).toEqual(["b", "a", "new.md", "old.md"]);
  });
});

describe("movedPath", () => {
  it("follows a moved file and the contents of a moved folder", () => {
    expect(movedPath("/p/a.md", "/p/a.md", "/p/x/a.md")).toBe("/p/x/a.md");
    expect(movedPath("/p/d/n.md", "/p/d", "/p/x/d")).toBe("/p/x/d/n.md");
    expect(movedPath("/p/dd/n.md", "/p/d", "/p/x/d")).toBeNull();
  });
});
