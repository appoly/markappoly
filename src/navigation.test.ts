import { describe, expect, it } from "vitest";
import { extractHeadings } from "./headings";
import {
  NavHistory,
  fileKind,
  headingForFragment,
  lineFromFragment,
  splitFragment,
} from "./navigation";

describe("splitFragment", () => {
  it("splits heading and line fragments", () => {
    expect(splitFragment("/d/guide.md#install")).toEqual({ path: "/d/guide.md", fragment: "install" });
    expect(splitFragment("/d/main.rs#L42")).toEqual({ path: "/d/main.rs", fragment: "L42" });
  });
  it("keeps a # that is part of the file name", () => {
    expect(splitFragment("/d/notes#2.md")).toEqual({ path: "/d/notes#2.md", fragment: null });
    expect(splitFragment("C:\\d\\a.md")).toEqual({ path: "C:\\d\\a.md", fragment: null });
  });
  it("drops an empty fragment", () => {
    expect(splitFragment("/d/a.md#")).toEqual({ path: "/d/a.md", fragment: null });
  });
});

describe("fileKind", () => {
  it("routes by extension", () => {
    expect(fileKind("/a/README.md")).toBe("markdown");
    expect(fileKind("/a/src/main.rs")).toBe("text");
    expect(fileKind("/a/notes.txt")).toBe("markdown");
    expect(fileKind("/a/Makefile")).toBe("text");
    expect(fileKind("/a/spec.pdf")).toBe("external");
    expect(fileKind("/a/setup.sh")).toBe("text");
    expect(fileKind("/a/tool.exe")).toBe("blocked");
    expect(fileKind("/a/App.app")).toBe("blocked");
  });
});

describe("fragments", () => {
  it("reads GitHub line anchors", () => {
    expect(lineFromFragment("L42")).toBe(42);
    expect(lineFromFragment("L10-L20")).toBe(10);
    expect(lineFromFragment("install")).toBeNull();
  });
  it("finds headings by slug or text", () => {
    const hs = extractHeadings("# Guide\n\n## Install & setup\n");
    expect(headingForFragment(hs, "install--setup")?.text).toBe("Install & setup");
    expect(headingForFragment(hs, "Install%20%26%20setup")?.text).toBe("Install & setup");
    expect(headingForFragment(hs, "nope")).toBeNull();
  });
});

describe("NavHistory", () => {
  const at = (docId: string, scroll = 0) => ({ docId, path: `/${docId}.md`, scroll });

  it("goes back and forward, and a new link clears forward", () => {
    const h = new NavHistory();
    h.push(at("a"));
    h.push(at("b"));
    expect(h.goBack(at("c"))).toEqual(at("b"));
    expect(h.goBack(at("b"))).toEqual(at("a"));
    expect(h.goBack(at("a"))).toBeNull();
    expect(h.goForward(at("a"))).toEqual(at("b"));
    h.push(at("b", 300));
    expect(h.canGoForward).toBe(false);
  });

  it("ignores duplicate pushes of the same place", () => {
    const h = new NavHistory();
    h.push(at("a", 10));
    h.push(at("a", 12));
    expect(h.goBack(at("b"))).toEqual(at("a", 10));
    expect(h.canGoBack).toBe(false);
  });
});
