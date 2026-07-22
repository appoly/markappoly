import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { FileEntry } from "./Sidebar";

/**
 * Autocomplete for Obsidian-style syntax in the editor:
 * `[[` suggests notes from the open folder, `#` suggests known tags.
 */
export function wikiCompletion(
  getFiles: () => FileEntry[],
  getTags: () => string[],
): Extension {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);

    const wiki = /\[\[([^\][]*)$/.exec(before);
    if (wiki) {
      const files = getFiles();
      if (files.length === 0) return null;
      // Duplicate basenames must insert their folder-qualified name so the
      // link resolves to the right file.
      const stemCount = new Map<string, number>();
      const entries = files.map((f) => {
        const base = f.name.split(/[\\/]/).pop() ?? f.name;
        const stem = base.replace(/\.[^.]+$/, "");
        stemCount.set(stem.toLowerCase(), (stemCount.get(stem.toLowerCase()) ?? 0) + 1);
        return { f, stem };
      });
      const options: Completion[] = entries.map(({ f, stem }) => {
        const qualified = (stemCount.get(stem.toLowerCase()) ?? 0) > 1;
        const target = qualified ? f.name.replace(/\.[^.]+$/, "") : stem;
        return {
          label: stem,
          detail: f.name === stem + ".md" ? undefined : f.name,
          // Auto-closing brackets may already have inserted `]]` after the
          // cursor; skip past it instead of doubling up.
          apply: (view, _completion, from, to) => {
            const closing = view.state.sliceDoc(to, to + 2) === "]]";
            const insert = closing ? target : `${target}]]`;
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length + (closing ? 2 : 0) },
            });
          },
          type: "text",
        };
      });
      return {
        from: ctx.pos - wiki[1].length,
        options,
        validFor: /^[^\][]*$/,
      };
    }

    const tag = /(^|[\s([{>])#([A-Za-z0-9_/-]*)$/.exec(before);
    if (tag) {
      const tags = getTags();
      if (tags.length === 0) return null;
      return {
        from: ctx.pos - tag[2].length - 1,
        options: tags.map((t) => ({ label: `#${t}`, type: "keyword" })),
        validFor: /^#[A-Za-z0-9_/-]*$/,
      };
    }

    return null;
  };

  return autocompletion({ override: [source], icons: false });
}
