import { describe, expect, it } from "vitest";
import { createOpenQueue, type OpenQueue } from "./openQueue";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createOpenQueue", () => {
  it("holds requests until flushed, then opens them in order", async () => {
    const opened: string[] = [];
    const queue = createOpenQueue(async (p) => {
      opened.push(p);
    });

    queue.request("/launch.md");
    queue.request("/second.md");
    await tick();
    expect(opened).toEqual([]);

    await queue.flush();
    expect(opened).toEqual(["/launch.md", "/second.md"]);
  });

  it("passes requests straight through once flushed", async () => {
    const opened: string[] = [];
    const queue = createOpenQueue(async (p) => {
      opened.push(p);
    });

    await queue.flush();
    queue.request("/later.md");
    await tick();
    expect(opened).toEqual(["/later.md"]);
  });

  it("waits for each open to finish before starting the next", async () => {
    const log: string[] = [];
    const queue = createOpenQueue(async (p) => {
      log.push(`start ${p}`);
      await tick();
      log.push(`end ${p}`);
    });

    queue.request("/a.md");
    queue.request("/b.md");
    await queue.flush();
    expect(log).toEqual(["start /a.md", "end /a.md", "start /b.md", "end /b.md"]);
  });

  it("drains requests that arrive while it is flushing", async () => {
    const opened: string[] = [];
    const queue: OpenQueue = createOpenQueue(async (p) => {
      opened.push(p);
      if (p === "/a.md") queue.request("/late.md");
    });

    queue.request("/a.md");
    await queue.flush();
    expect(opened).toEqual(["/a.md", "/late.md"]);
  });

  it("keeps going when an open fails", async () => {
    const opened: string[] = [];
    const queue = createOpenQueue(async (p) => {
      if (p === "/missing.md") throw new Error("ENOENT");
      opened.push(p);
    });

    queue.request("/missing.md");
    queue.request("/ok.md");
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(opened).toEqual(["/ok.md"]);

    queue.request("/missing.md");
    await tick();
    expect(opened).toEqual(["/ok.md"]);
  });
});
