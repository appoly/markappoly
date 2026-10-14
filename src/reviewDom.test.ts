// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Preview } from "./markdown";
import { diffLines } from "./review";
import { blockForLine, lineForNode, markChanges, markComments } from "./reviewDom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(source: string, onToggleTask: (line: number) => void = () => {}) {
  const host = document.createElement("div");
  host.className = "markdown-body";
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Preview, { source, dark: false, onToggleTask }));
  });
  return host;
}

const before = ["# Plan", "", "Intro text.", "", "## Setup", "", "Install it.", "", "## Deploy", "", "Ship it.", ""].join("\n");
const after = ["# Plan", "", "Intro text.", "", "## Setup", "", "Install it with npm.", "", "A brand new step.", "", "## Deploy", ""].join("\n");

describe("review marks on the rendered preview", () => {
  it("marks changed and added blocks and the removal point", async () => {
    const body = await render(after);
    const hunks = diffLines(before, after);
    const targets = markChanges(body, hunks);
    const marked = [...body.querySelectorAll<HTMLElement>("[data-review]")].map(
      (el) => `${el.dataset.review}:${el.textContent}`,
    );
    expect(marked).toContain("changed:Install it with npm.");
    expect(marked.some((m) => m.endsWith("A brand new step."))).toBe(true);
    // "Ship it." was removed after the last heading: marked below it.
    const removed = body.querySelector<HTMLElement>("[data-review-removed]");
    expect(removed?.textContent).toBe("Deploy");
    expect(removed?.dataset.reviewRemoved).toBe("below");
    expect(removed?.title).toContain("Ship it.");
    expect(body.querySelector("h2[data-review]")).toBeNull();
    expect(targets.every((t) => t instanceof HTMLElement)).toBe(true);
  });

  it("anchors comments to blocks and maps selections back to lines", async () => {
    const body = await render(after);
    const p = blockForLine(body, 7)!;
    expect(p.textContent).toBe("Install it with npm.");
    expect(lineForNode(body, p.firstChild)).toBe(7);
    const anchors = markComments(body, [
      { id: "c1", line: 7, at: 7, quote: "with npm", text: "pnpm?", created: 1 },
    ]);
    expect(anchors.get("c1")).toBe(p);
    expect(p.dataset.comment).toBe("1");
  });

  it("checkboxes report their own source line, past code samples", async () => {
    const lines: number[] = [];
    const body = await render(
      ["```md", "- [ ] sample", "```", "", "- [ ] real"].join("\n"),
      (l) => lines.push(l),
    );
    const box = body.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await act(async () => box.click());
    expect(lines).toEqual([5]);
  });
});
