import { describe, expect, it } from "vitest";
import { fillTemplate, formatDate, formatTime, isInFolder, noteFileName } from "./template";

const AT = new Date(2026, 7, 10, 9, 5); // 2026-08-10 09:05 local

describe("formatDate / formatTime", () => {
  it("zero-pads", () => {
    expect(formatDate(AT)).toBe("2026-08-10");
    expect(formatTime(AT)).toBe("09:05");
  });
});

describe("fillTemplate", () => {
  it("substitutes title, date and time", () => {
    const out = fillTemplate("# {{title}}\n{{date}} {{time}}", "Standup", AT);
    expect(out).toBe("# Standup\n2026-08-10 09:05");
  });

  it("is case-insensitive and tolerates spaces", () => {
    expect(fillTemplate("{{ Title }} on {{DATE}}", "X", AT)).toBe("X on 2026-08-10");
  });

  it("leaves unknown placeholders alone", () => {
    expect(fillTemplate("{{author}}", "X", AT)).toBe("{{author}}");
  });

  it("keeps $ sequences in the title literal", () => {
    expect(fillTemplate("{{title}}", "Payroll $$ August", AT)).toBe("Payroll $$ August");
    expect(fillTemplate("{{title}}", "a $& b $' c", AT)).toBe("a $& b $' c");
  });
});

describe("noteFileName", () => {
  it("appends .md and strips unsafe characters", () => {
    expect(noteFileName("My: Note?")).toBe("My- Note-.md");
    expect(noteFileName("plans/2026")).toBe("plans-2026.md");
  });

  it("keeps an existing markdown extension", () => {
    expect(noteFileName("note.markdown")).toBe("note.markdown");
  });

  it("returns empty for blank or dot-only names", () => {
    expect(noteFileName("   ")).toBe("");
    expect(noteFileName("..")).toBe("");
  });
});

describe("isInFolder", () => {
  it("matches direct and nested children of the top-level folder", () => {
    expect(isInFolder("Templates/Meeting.md", "Templates")).toBe(true);
    expect(isInFolder("templates\\Sub\\X.md", "Templates")).toBe(true);
  });

  it("rejects other folders, root files, and blank folder names", () => {
    expect(isInFolder("Notes/Meeting.md", "Templates")).toBe(false);
    expect(isInFolder("Meeting.md", "Templates")).toBe(false);
    expect(isInFolder("Templates/X.md", "")).toBe(false);
  });
});
