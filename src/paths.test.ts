import { describe, expect, it } from "vitest";
import {
  basename,
  dirOf,
  isAbsolutePath,
  isLocalMarkdownHref,
  resolveRelativePath,
} from "./paths";

describe("basename", () => {
  it("returns Untitled for empty", () => {
    expect(basename(null)).toBe("Untitled");
    expect(basename("")).toBe("Untitled");
  });
  it("strips directories on POSIX and Windows", () => {
    expect(basename("/Users/me/notes/hello.md")).toBe("hello.md");
    expect(basename("C:\\Users\\me\\notes\\hello.md")).toBe("hello.md");
  });
});

describe("dirOf", () => {
  it("returns parent directory", () => {
    expect(dirOf("/a/b/c.md")).toBe("/a/b");
    expect(dirOf("C:\\a\\b\\c.md")).toBe("C:\\a\\b");
  });
  it("returns undefined for bare names", () => {
    expect(dirOf("readme.md")).toBeUndefined();
  });
});

describe("isAbsolutePath", () => {
  it("detects POSIX and Windows absolute paths", () => {
    expect(isAbsolutePath("/tmp/x")).toBe(true);
    expect(isAbsolutePath("C:\\tmp\\x")).toBe(true);
    expect(isAbsolutePath("notes.md")).toBe(false);
    expect(isAbsolutePath("./notes.md")).toBe(false);
  });
});

describe("resolveRelativePath", () => {
  it("joins a simple relative path", () => {
    expect(resolveRelativePath("/docs/guide", "intro.md")).toBe("/docs/guide/intro.md");
    expect(resolveRelativePath("/docs/guide", "./intro.md")).toBe("/docs/guide/intro.md");
  });
  it("handles parent segments", () => {
    expect(resolveRelativePath("/docs/guide", "../api/ref.md")).toBe("/docs/api/ref.md");
  });
  it("strips hash fragments", () => {
    expect(resolveRelativePath("/docs", "other.md#section")).toBe("/docs/other.md");
  });
  it("keeps absolute targets", () => {
    expect(resolveRelativePath("/docs", "/elsewhere/x.md")).toBe("/elsewhere/x.md");
  });
  it("handles Windows bases", () => {
    expect(resolveRelativePath("C:\\notes\\proj", "sub\\a.md")).toBe("C:\\notes\\proj\\sub\\a.md");
    expect(resolveRelativePath("C:\\notes\\proj", "..\\other.md")).toBe("C:\\notes\\other.md");
  });
});

describe("isLocalMarkdownHref", () => {
  it("accepts local markdown paths", () => {
    expect(isLocalMarkdownHref("./notes.md")).toBe(true);
    expect(isLocalMarkdownHref("../a/b.markdown")).toBe(true);
    expect(isLocalMarkdownHref("readme.txt")).toBe(true);
  });
  it("rejects remote and non-markdown", () => {
    expect(isLocalMarkdownHref("https://example.com/a.md")).toBe(false);
    expect(isLocalMarkdownHref("mailto:a@b.c")).toBe(false);
    expect(isLocalMarkdownHref("#anchor")).toBe(false);
    expect(isLocalMarkdownHref("./image.png")).toBe(false);
    expect(isLocalMarkdownHref("./noext")).toBe(false);
  });
});
