import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  service.use(gfm); // tables, strikethrough, task lists
  return service;
}

/** Convert an HTML fragment (e.g. pasted rich text) to Markdown. */
export function htmlToMarkdown(html: string): string {
  try {
    return getService().turndown(html).trim();
  } catch {
    return "";
  }
}
