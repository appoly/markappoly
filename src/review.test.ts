import { describe, expect, it } from "vitest";
import { extractHeadings } from "./headings";
import {
  changedSections,
  describeChanges,
  diffLines,
  formatFeedback,
  relocateComment,
  type ReviewComment,
} from "./review";

describe("diffLines", () => {
  it("returns nothing for identical text", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([]);
  });

  it("finds added, changed and removed lines with current-text line numbers", () => {
    const before = ["# T", "one", "two", "three", "four"].join("\n");
    const after = ["# T", "one", "TWO", "three", "new", "four"].join("\n");
    expect(diffLines(before, after)).toEqual([
      { kind: "changed", start: 3, end: 3, before: "two" },
      { kind: "added", start: 5, end: 5, before: "" },
    ]);
  });

  it("reports removals as a gap before the following line", () => {
    const hunks = diffLines("a\nb\nc\nd", "a\nd");
    expect(hunks).toEqual([{ kind: "removed", start: 2, end: 1, before: "b\nc" }]);
  });

  it("handles empty sides and CRLF", () => {
    expect(diffLines("", "x\ny")).toEqual([{ kind: "added", start: 1, end: 2, before: "" }]);
    expect(diffLines("a\r\nb", "a\nb")).toEqual([]);
  });

  it("ignores blank-line-only changes and keeps headings anchored", () => {
    expect(diffLines("a\n\nb", "a\n\n\nb")).toEqual([]);
    const before = ["## Setup", "", "Install it.", "", "## Deploy", "", "Ship it.", ""].join("\n");
    const after = ["## Setup", "", "Install it.", "", "New step.", "", "## Deploy", ""].join("\n");
    expect(diffLines(before, after)).toEqual([
      { kind: "added", start: 5, end: 5, before: "" },
      { kind: "removed", start: 9, end: 8, before: "Ship it." },
    ]);
  });

  it("stays fast on a long document with scattered edits", () => {
    const base = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const next = [...base];
    next[100] = "edited";
    next.splice(15000, 3);
    const t = performance.now();
    const hunks = diffLines(base.join("\n"), next.join("\n"));
    expect(performance.now() - t).toBeLessThan(500);
    expect(hunks.map((h) => h.kind)).toEqual(["changed", "removed"]);
  });
});

describe("sections and summary", () => {
  const doc = ["# Plan", "intro", "## Setup", "step", "## Deploy", "go"].join("\n");
  const headings = extractHeadings(doc);

  it("groups hunks by the section they fall in", () => {
    const hunks = diffLines(doc, doc.replace("step", "step!").replace("go", "go!"));
    expect(changedSections(headings, hunks).map((h) => h.text)).toEqual(["Setup", "Deploy"]);
    expect(describeChanges(hunks, 2)).toBe("2 changes in 2 sections");
    expect(describeChanges(hunks.slice(0, 1), 1)).toBe("1 change");
  });
});

describe("comments", () => {
  const c = (over: Partial<ReviewComment>): ReviewComment => ({
    id: "1",
    line: 4,
    quote: "Run the migration",
    text: "Which migration?",
    created: 1,
    ...over,
  });

  it("follows a quoted passage that moved", () => {
    const src = ["# Steps", "", "New intro.", "", "More.", "", "Run the **migration** first."].join("\n");
    expect(relocateComment(src, c({}))).toBe(7);
  });

  it("marks a comment whose passage is gone", () => {
    expect(relocateComment("# Steps\n\nNothing here.", c({}))).toBe(-1);
  });

  it("formats feedback by position with sections and quotes", () => {
    const doc = ["# Plan", "", "## Setup", "", "Run the migration", "", "## Deploy", "", "Ship it"].join("\n");
    const out = formatFeedback({
      path: "/repo/PLAN.md",
      name: "PLAN.md",
      headings: extractHeadings(doc),
      comments: [
        c({ id: "b", line: 9, quote: "Ship it", text: "Not on a Friday." }),
        c({ id: "a", line: 5, text: "Which migration?\nThe users one?" }),
      ],
    });
    expect(out).toBe(
      [
        "Feedback on `/repo/PLAN.md`:",
        "",
        "1. **§ Setup (line 5)**",
        "   > Run the migration",
        "",
        "   Which migration?",
        "   The users one?",
        "",
        "2. **§ Deploy (line 9)**",
        "   > Ship it",
        "",
        "   Not on a Friday.",
        "",
      ].join("\n"),
    );
  });
});
