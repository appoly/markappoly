import { describe, expect, it, vi } from "vitest";
import { createDocumentSaver, type SaveIO } from "./saveDocument";
import { makeDoc } from "./types";

function fixture(overrides: Partial<SaveIO> = {}) {
  let doc = makeDoc({
    path: "/note.md",
    source: "edited",
    dirty: true,
    mtime: 10,
  });
  const io: SaveIO = {
    readMtime: vi.fn(async () => 10),
    snapshot: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
    overwrite: vi.fn(async () => false),
    ...overrides,
  };
  const saver = createDocumentSaver(
    io,
    () => doc,
    (_id, update) => {
      doc = { ...doc, ...update };
    },
  );
  return {
    io,
    save: (manual = false) => saver(doc.id, manual),
    get: () => doc,
    edit: (source: string) => {
      doc = { ...doc, source, dirty: true };
    },
  };
}
describe("document saving", () => {
  it("leaves external changes untouched and exposes a conflict", async () => {
    const f = fixture({ readMtime: async () => 20 });
    expect(await f.save()).toBe(false);
    expect(f.io.write).not.toHaveBeenCalled();
    expect(f.get().saveStatus).toBe("conflict");
    expect(f.get().dirty).toBe(true);
  });
  it("does not overwrite when manual conflict confirmation is cancelled", async () => {
    const f = fixture({ readMtime: async () => 20 });
    expect(await f.save(true)).toBe(false);
    expect(f.io.overwrite).toHaveBeenCalledOnce();
    expect(f.io.snapshot).not.toHaveBeenCalled();
    expect(f.io.write).not.toHaveBeenCalled();
  });
  it("snapshots before a confirmed overwrite", async () => {
    const order: string[] = [];
    const f = fixture({
      readMtime: async () => 20,
      overwrite: async () => true,
      snapshot: async () => {
        order.push("snapshot");
      },
      write: async () => {
        order.push("write");
      },
    });
    expect(await f.save(true)).toBe(true);
    expect(order).toEqual(["snapshot", "write"]);
    expect(f.get().dirty).toBe(false);
  });
  it("keeps failed writes dirty and supports an explicit retry", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValue(undefined);
    const f = fixture({ write });
    expect(await f.save()).toBe(false);
    expect(f.get()).toMatchObject({
      dirty: true,
      saveStatus: "error",
      saveError: "Error: Disk full",
    });
    await f.save();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await f.save(true)).toBe(true);
  });
  it("never marks edits made during a write as saved", async () => {
    let release!: () => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const f = fixture({
      write: () => {
        start();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const saving = f.save();
    await started;
    f.edit("newer changes");
    release();
    expect(await saving).toBe(false);
    expect(f.get()).toMatchObject({ source: "newer changes", dirty: true });
  });
  it("serializes concurrent requests without duplicate writes", async () => {
    const f = fixture();
    await Promise.all([f.save(), f.save(true), f.save(true)]);
    expect(f.io.write).toHaveBeenCalledOnce();
  });
  it("does not overwrite when the original file cannot be checked", async () => {
    const f = fixture({
      readMtime: async () => {
        throw new Error("Unavailable");
      },
    });
    expect(await f.save(true)).toBe(false);
    expect(f.io.write).not.toHaveBeenCalled();
    expect(f.get().saveStatus).toBe("error");
  });
});
