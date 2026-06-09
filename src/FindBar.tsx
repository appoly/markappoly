import { useEffect, useRef, useState } from "react";

// CSS Custom Highlight API (not yet in TS lib types).
declare const Highlight: {
  new (...ranges: Range[]): unknown;
};
type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

function highlights(): HighlightRegistry | null {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;
}

/** Find-in-preview bar using the CSS Custom Highlight API (no DOM mutation). */
export function FindBar({
  container,
  onClose,
}: {
  container: HTMLElement | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const reg = highlights();
    if (!reg || !container) return;
    reg.delete("find");
    reg.delete("find-current");

    const ranges: Range[] = [];
    if (query) {
      const q = query.toLowerCase();
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue ?? "").toLowerCase();
        let idx = text.indexOf(q);
        while (idx !== -1) {
          const r = new Range();
          r.setStart(node, idx);
          r.setEnd(node, idx + query.length);
          ranges.push(r);
          idx = text.indexOf(q, idx + query.length);
        }
      }
    }

    rangesRef.current = ranges;
    setCount(ranges.length);
    setCurrent(ranges.length ? 0 : -1);
    if (ranges.length) {
      reg.set("find", new Highlight(...ranges));
      focusRange(0, ranges);
    }

    return () => {
      reg.delete("find");
      reg.delete("find-current");
    };
  }, [query, container]);

  function focusRange(i: number, ranges = rangesRef.current) {
    const reg = highlights();
    if (!reg || !ranges.length) return;
    const r = ranges[i];
    reg.set("find-current", new Highlight(r.cloneRange()));
    r.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }

  function go(delta: number) {
    if (!count) return;
    const next = (current + delta + count) % count;
    setCurrent(next);
    focusRange(next);
  }

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        placeholder="Find"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="find-count">
        {count ? `${current + 1}/${count}` : query ? "0/0" : ""}
      </span>
      <button className="fmt" onClick={() => go(-1)} disabled={!count} title="Previous">
        ↑
      </button>
      <button className="fmt" onClick={() => go(1)} disabled={!count} title="Next">
        ↓
      </button>
      <button className="fmt" onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  );
}
