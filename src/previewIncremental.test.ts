// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Preview } from "./markdown";

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
