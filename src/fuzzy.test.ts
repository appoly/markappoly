import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyScorePath } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequences", () => {
    expect(fuzzyMatch("mdv", "markdown-viewer")).not.toBeNull();
    expect(fuzzyMatch("xyz", "markdown-viewer")).toBeNull();
  });

  it("scores consecutive runs above scattered matches", () => {
    const tight = fuzzyMatch("read", "readme")!;
    const loose = fuzzyMatch("read", "r-e-a-d-me")!;
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("ReadMe", "README.md")).not.toBeNull();
  });

  it("matches everything on an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });
});

describe("fuzzyScorePath", () => {
  it("prefers basename matches over deep path matches", () => {
    const onBase = fuzzyScorePath("notes", "archive/notes.md")!;
    const onDir = fuzzyScorePath("notes", "notes-archive/other.md")!;
    expect(onBase).toBeGreaterThan(onDir);
  });

  it("returns null when nothing matches", () => {
    expect(fuzzyScorePath("zzz", "readme.md")).toBeNull();
  });
});
