import { useEffect, useRef, useState } from "react";

let counter = 0;

/** Renders a Mermaid diagram from a fenced ```mermaid code block. */
export function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    // Dynamic import keeps Mermaid out of the critical startup path.
    import("mermaid")
      .then(({ default: mermaid }) => {
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "default",
          securityLevel: "strict",
        });
        const id = `mermaid-${counter++}`;
        return mermaid.render(id, code).then(({ svg }) => {
          if (cancelled || !ref.current) return;
          ref.current.innerHTML = svg;
          setError(null);
          setPending(false);
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, dark]);

  if (error) return <pre className="mermaid-error">{error}</pre>;
  return (
    <div className="mermaid-diagram" ref={ref} data-pending={pending || undefined}>
      {pending && !ref.current?.innerHTML ? (
        <div className="mermaid-pending">Rendering diagram…</div>
      ) : null}
    </div>
  );
}
