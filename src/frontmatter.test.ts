import { describe, expect, it } from "vitest";
import {
  frontmatterTags,
  frontmatterTitle,
  parseFrontmatter,
  parseSimpleYaml,
  replaceFrontmatter,
  serializeYaml,
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

describe("serializeYaml", () => {
  it("round-trips through parseSimpleYaml", () => {
    const data = {
      title: "Hello: world",
      tags: ["alpha", "beta"],
      draft: "true",
    };
    expect(parseSimpleYaml(serializeYaml(data))).toEqual(data);
  });
});

describe("replaceFrontmatter", () => {
  it("replaces an existing block", () => {
    const src = "---\ntitle: Old\n---\n# Body\n";
    const next = replaceFrontmatter(src, { title: "New" });
    expect(next).toBe("---\ntitle: New\n---\n# Body\n");
  });

  it("inserts a block when none exists", () => {
    const next = replaceFrontmatter("# Body\n", { title: "Added" });
    expect(next).toBe("---\ntitle: Added\n---\n\n# Body\n");
    expect(parseFrontmatter(next)!.data.title).toBe("Added");
  });

  it("removes the block when the map is empty", () => {
    expect(replaceFrontmatter("---\ntitle: Old\n---\n# Body\n", {})).toBe("# Body\n");
  });

  it("keeps dollar signs in values literal", () => {
    const next = replaceFrontmatter("---\ntitle: Old\n---\nBody\n", { title: "$100 & more" });
    expect(parseFrontmatter(next)!.data.title).toBe("$100 & more");
  });
});
