import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let counter = 0;

/** Renders a Mermaid diagram from a fenced ```mermaid code block. */
export function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
    });
    const id = `mermaid-${counter++}`;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code, dark]);

  if (error) return <pre className="mermaid-error">{error}</pre>;
  return <div className="mermaid-diagram" ref={ref} />;
}
