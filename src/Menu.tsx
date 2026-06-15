import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuEntry =
  | { type: "item"; label: ReactNode; onSelect: () => void; checked?: boolean; disabled?: boolean }
  | { type: "header"; label: string }
  | { type: "separator" };

/** A toolbar button that opens a popover menu. Closes on outside click, Escape,
 *  or after an item is chosen. */
export function Menu({
  label,
  title,
  items,
  align = "left",
  className = "",
}: {
  label: ReactNode;
  title?: string;
  items: MenuEntry[];
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={className}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className={`menu-pop${align === "right" ? " align-right" : ""}`} role="menu">
          {items.map((it, i) => {
            if (it.type === "separator") return <div key={i} className="menu-sep" />;
            if (it.type === "header")
              return (
                <div key={i} className="menu-header">
                  {it.label}
                </div>
              );
            return (
              <button
                key={i}
                className="menu-item"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span className="menu-check">{it.checked ? "✓" : ""}</span>
                <span className="menu-label">{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
