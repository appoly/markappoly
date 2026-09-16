import { useEffect, useId, useRef, useState } from "react";
import type { Heading } from "./headings";
import "./HeadingRail.css";

/** A compact outline for reading with the sidebar tucked away. */
export function HeadingRail({ headings, activeSlug, onNavigate }: {
  headings: Heading[];
  activeSlug: string | null;
  onNavigate: (heading: Heading) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const outlineId = useId();
  const activeIndex = Math.max(0, headings.findIndex((h) => h.slug === activeSlug));
  // Keep the rail short even for books; the expanded outline includes every heading.
  const start = Math.max(0, Math.min(activeIndex - 8, headings.length - 18));
  const visible = headings.slice(start, start + 18);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      if (root.current?.contains(document.activeElement)) {
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (open) root.current?.querySelector('[aria-current="location"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <nav
      className="heading-rail"
      aria-label="Document sections"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="heading-rail-trigger"
        aria-label="Document outline"
        aria-expanded={open}
        aria-controls={outlineId}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => {
              const current = root.current?.querySelector<HTMLButtonElement>(
                '.heading-rail-outline [aria-current="location"]',
              );
              (current ?? root.current?.querySelector<HTMLButtonElement>(
                ".heading-rail-outline button",
              ))?.focus();
            });
          }
        }}
      >
        <span className="heading-rail-marks" aria-hidden="true">
          {visible.map((h) => (
            <span key={h.slug} className={h.slug === activeSlug ? "current" : ""}
              style={{ marginInlineStart: Math.min(h.depth - 1, 3) * 3 }} />
          ))}
        </span>
      </button>
      <div className="heading-rail-popover" id={outlineId} hidden={!open}>
        <div className="heading-rail-title">On this page</div>
        <ol className="heading-rail-outline">
          {headings.map((h) => (
            <li key={h.slug}>
              <button
                aria-current={h.slug === activeSlug ? "location" : undefined}
                style={{ paddingInlineStart: 12 + (h.depth - 1) * 12 }}
                onClick={() => {
                  onNavigate(h);
                  setOpen(false);
                  trigger.current?.focus({ preventScroll: true });
                }}
              >{h.text}</button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
