import { describe, expect, it } from "vitest";
import { toggleTaskAtLine } from "./tasks";

describe("toggleTaskAtLine", () => {
  const doc = ["# Todo", "", "```md", "- [ ] example", "```", "", "- [ ] real", "- [x] done"].join("\n");

  it("toggles the task on the given line, not one inside a code sample", () => {
    const out = toggleTaskAtLine(doc, 7).split("\n");
    expect(out[3]).toBe("- [ ] example");
    expect(out[6]).toBe("- [x] real");
  });

  it("unchecks a checked task", () => {
    expect(toggleTaskAtLine(doc, 8).split("\n")[7]).toBe("- [ ] done");
  });

  it("handles ordered, nested and quoted items", () => {
    expect(toggleTaskAtLine("1. [ ] a", 1)).toBe("1. [x] a");
    expect(toggleTaskAtLine("  - [X] b", 1)).toBe("  - [ ] b");
    expect(toggleTaskAtLine("> - [ ] c", 1)).toBe("> - [x] c");
  });

  it("leaves non-task lines and out-of-range lines alone", () => {
    expect(toggleTaskAtLine(doc, 1)).toBe(doc);
    expect(toggleTaskAtLine(doc, 99)).toBe(doc);
  });

  it("preserves CRLF line endings", () => {
    expect(toggleTaskAtLine("- [ ] a\r\n- [ ] b", 2)).toBe("- [ ] a\r\n- [x] b");
  });
});
