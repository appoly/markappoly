// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { finishPreviews, Preview, previewsPending, whenPreviewsComplete } from "./markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement("div");
  host.className = "markdown-body";
  document.body.appendChild(host);
  const root = createRoot(host);
  const toggled: number[] = [];
  const render = (source: string) =>
    act(async () => {
      root.render(
        createElement(Preview, { source, dark: false, onToggleTask: (l) => toggled.push(l) }),
      );
    });
  return { host, render, toggled };
}

const doc = ["# Title", "", "First paragraph.", "", "## Notes", "", "- [ ] task", "", "Last."].join("\n");

describe("incremental preview", () => {
  it("keeps the DOM of untouched blocks when another block is edited", async () => {
    const { host, render } = mount();
    await render(doc);
    const [h1, p1, , , last] = Array.from(host.children);
    await render(doc.replace("First paragraph.", "First paragraph, edited."));
    const after = Array.from(host.children);
    expect(after[0]).toBe(h1);
    expect(after[1]).not.toBe(p1);
    expect(after[1].textContent).toBe("First paragraph, edited.");
    expect(after[4]).toBe(last);
  });

  it("shifts source lines below an inserted line without re-rendering", async () => {
    const { host, render, toggled } = mount();
    await render(doc);
    const last = host.lastElementChild as HTMLElement;
    expect(last.dataset.sourceLine).toBe("9");
    await render("Intro.\n\n" + doc);
    expect(host.lastElementChild).toBe(last);
    expect(last.dataset.sourceLine).toBe("11");
    const box = host.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await act(async () => box.click());
    expect(toggled).toEqual([9]);
  });

  it("deduplicates heading ids across blocks and updates them as headings move", async () => {
    const { host, render } = mount();
    await render("## Setup\n\nA\n\n## Setup");
    expect(Array.from(host.querySelectorAll("h2")).map((h) => h.id)).toEqual(["setup", "setup-1"]);
    await render("## Setup\n\nA\n\n## Setup\n\n## Setup");
    expect(Array.from(host.querySelectorAll("h2")).map((h) => h.id)).toEqual([
      "setup",
      "setup-1",
      "setup-2",
    ]);
    await render("A\n\n## Setup");
    expect(host.querySelector("h2")!.id).toBe("setup");
  });
});

describe("progressive rendering of long documents", () => {
  const long = Array.from({ length: 400 }, (_, i) => `## Part ${i}\n\nUnique paragraph number ${i} with some *text* in it.`).join("\n\n");

  it("paints the start first and completes on its own", async () => {
    // Fake timers, so a slow machine can't run the follow-up passes before
    // the first one is checked.
    vi.useFakeTimers();
    try {
      const { host, render } = mount();
      await render(long);
      const first = host.querySelectorAll("h2").length;
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(400);
      expect(previewsPending()).toBe(true);
      for (let i = 0; i < 100 && previewsPending(); i++) {
        await act(async () => {
          vi.runOnlyPendingTimers();
        });
      }
      expect(previewsPending()).toBe(false);
      expect(host.querySelectorAll("h2").length).toBe(400);
      expect(host.querySelector<HTMLElement>("#part-399")?.dataset.sourceLine).toBe("1597");
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes synchronously for lookups that need the whole document", async () => {
    const { host, render } = mount();
    await render(long.replace(/Unique/g, "Other"));
    expect(previewsPending()).toBe(true);
    act(() => finishPreviews());
    expect(previewsPending()).toBe(false);
    expect(document.getElementById("part-399")).not.toBeNull();
    expect(host.querySelectorAll("h2").length).toBe(400);
  });

  it("renders an edit that touches many blocks in one go", async () => {
    const { host, render } = mount();
    const doc = long.replace(/Unique/g, "Fourth");
    await render(doc);
    act(() => finishPreviews());
    await render(doc.replace(/some \*text\*/g, "other *text*"));
    expect(previewsPending()).toBe(false);
    expect(host.querySelectorAll("h2").length).toBe(400);
  });

  it("runs waiting callbacks once the document is complete", async () => {
    const { host, render } = mount();
    await render(long.replace(/Unique/g, "Third"));
    let seen = -1;
    whenPreviewsComplete(() => {
      seen = host.querySelectorAll("h2").length;
    });
    expect(seen).toBe(-1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen).toBe(400);
  });
});
