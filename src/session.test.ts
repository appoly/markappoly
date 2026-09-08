import { beforeEach, describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./session";

// Minimal localStorage for node.
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

describe("session", () => {
  beforeEach(() => {
    store.clear();
    clearSession();
  });

  it("round-trips a session", () => {
    saveSession({
      version: 1,
      paths: ["/a.md", "/b.md"],
      activePath: "/b.md",
      mode: "split",
      folderPath: "/notes",
    });
    expect(loadSession()).toEqual({
      version: 1,
      paths: ["/a.md", "/b.md"],
      activePath: "/b.md",
      mode: "split",
      folderPath: "/notes",
    });
  });

  it("falls back on corrupt data", () => {
    localStorage.setItem("mv.session", "{not json");
    expect(loadSession().paths).toEqual([]);
    expect(loadSession().mode).toBe("preview");
  });
});

describe("per-document view preferences", () => {
  it("restores independent view modes while accepting old sessions", () => {
    saveSession({
      version: 1,
      paths: ["/a.md", "/b.md"],
      activePath: "/b.md",
      mode: "split",
      folderPath: null,
      pathModes: { "/a.md": "preview", "/b.md": "split" },
    });
    expect(loadSession().pathModes).toEqual({
      "/a.md": "preview",
      "/b.md": "split",
    });
  });
  it("drops invalid modes from stored sessions", () => {
    localStorage.setItem(
      "mv.session",
      JSON.stringify({
        version: 1,
        paths: [],
        pathModes: { a: "edit", b: "invalid" },
      }),
    );
    expect(loadSession().pathModes).toEqual({ a: "edit" });
  });
});
