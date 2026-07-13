import GithubSlugger from "github-slugger";

export type Heading = { depth: number; text: string; slug: string; line: number };

/** Extract headings (with github-slugger slugs matching rehype-slug) for the outline. */
export function extractHeadings(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;
  let inFrontmatter = false;
  source.split("\n").forEach((line, i) => {
    // Skip YAML frontmatter so `#` keys inside it are not treated as headings.
    if (i === 0 && /^---\s*$/.test(line)) {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (/^---\s*$/.test(line)) inFrontmatter = false;
      return;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].replace(/\s*#+\s*$/, "").trim();
      headings.push({ depth: m[1].length, text, slug: slugger.slug(text), line: i });
    }
  });
  return headings;
}
