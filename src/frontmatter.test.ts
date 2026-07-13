import { describe, expect, it } from "vitest";
import {
  frontmatterTags,
  frontmatterTitle,
  parseFrontmatter,
  parseSimpleYaml,
} from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("# Hello\n\nBody")).toBeNull();
  });

  it("parses title and tags", () => {
    const src = `---
title: My Note
tags: [alpha, beta]
date: 2024-01-01
---
# Heading

Body text.
`;
    const fm = parseFrontmatter(src);
    expect(fm).not.toBeNull();
    expect(fm!.body.startsWith("# Heading")).toBe(true);
    expect(frontmatterTitle(fm!.data)).toBe("My Note");
    expect(frontmatterTags(fm!.data)).toEqual(["alpha", "beta"]);
    expect(fm!.data.date).toBe("2024-01-01");
  });

  it("parses list-style tags", () => {
    const yaml = `tags:
  - one
  - two`;
    const data = parseSimpleYaml(yaml);
    expect(data.tags).toEqual(["one", "two"]);
  });

  it("handles quoted values", () => {
    const data = parseSimpleYaml(`title: "Hello: world"\nname: 'plain'`);
    expect(data.title).toBe("Hello: world");
    expect(data.name).toBe("plain");
  });
});
