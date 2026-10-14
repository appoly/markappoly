import { describe, expect, it } from "vitest";
import { splitHighlightedLines } from "./CodeView";

describe("splitHighlightedLines", () => {
  it("closes and reopens spans that cross line breaks", () => {
    const html = 'a <span class="c">/* x\ny */</span> b\nc';
    expect(splitHighlightedLines(html)).toEqual([
      'a <span class="c">/* x</span>',
      '<span class="c">y */</span> b',
      "c",
    ]);
  });
  it("handles nested spans and escaped text", () => {
    const html = '<span class="s">"&lt;<span class="e">\\n</span>\n"</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="s">"&lt;<span class="e">\\n</span></span>',
      '<span class="s">"</span>',
    ]);
  });
});
