import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export type MenuEntry =
  | { type: "item"; label: ReactNode; onSelect: () => void; checked?: boolean; disabled?: boolean }
  | { type: "header"; label: string }
  | { type: "separator" };

/** A toolbar button that opens a popover menu. Closes on outside click, Escape,
 *  or after an item is chosen. Fully keyboard-navigable: ↑/↓ move between items,
 *  Home/End jump to the ends, and Escape/Tab return focus to the trigger. */
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
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  const enabledItems = () =>
    Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  // Close on a click anywhere outside the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (open) enabledItems()[0]?.focus();
  }, [open]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    const list = enabledItems();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        list[i < 0 ? 0 : (i + 1) % list.length].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        list[i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length].focus();
        break;
      case "Home":
        e.preventDefault();
        list[0].focus();
        break;
      case "End":
        e.preventDefault();
        list[list.length - 1].focus();
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        className={className}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {open && (
        <div
          className={`menu-pop${align === "right" ? " align-right" : ""}`}
          role="menu"
          ref={pop}
          onKeyDown={onMenuKeyDown}
        >
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
                  close(false);
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
