import { useRef, useState } from "react";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: {
  tabs: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void | Promise<void>;
  onNew: () => void;
  /** Move a tab to a new index (drag to reorder). */
  onReorder?: (id: string, toIndex: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  /** The index the dragged tab should take with the pointer at `x`. */
  const indexAt = (x: number) => {
    const els = list.current?.querySelectorAll<HTMLElement>(".tab") ?? [];
    let i = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x > r.left + r.width / 2) i++;
    }
    return i;
  };
  return (
    <div className="tab-strip">
      <div
        className="tab-bar"
        ref={list}
        role="tablist"
        aria-label="Open documents"
        onKeyDown={(e) => {
          const index = tabs.findIndex((t) => t.id === activeId);
          const next =
            e.key === "ArrowRight"
              ? (index + 1) % tabs.length
              : e.key === "ArrowLeft"
                ? (index - 1 + tabs.length) % tabs.length
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : -1;
          if (next >= 0) {
            e.preventDefault();
            onSelect(tabs[next].id);
            list.current
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          } else if (e.key === "Delete") {
            e.preventDefault();
            onClose(activeId);
          }
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            className={
              "tab" +
              (t.id === activeId ? " active" : "") +
              (t.id === dragId ? " dragging" : "")
            }
            role="presentation"
            onPointerDown={(e) => {
              if (!onReorder || e.button !== 0) return;
              if ((e.target as HTMLElement).closest(".tab-close")) return;
              drag.current = { id: t.id, x: e.clientX, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== t.id || !onReorder) return;
              if (!d.moved) {
                if (Math.abs(e.clientX - d.x) < 5) return;
                d.moved = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragId(t.id);
              }
              const from = tabs.findIndex((x) => x.id === t.id);
              let to = indexAt(e.clientX);
              if (to > from) to--;
              if (to !== from) onReorder(t.id, to);
            }}
            onPointerUp={(e) => {
              if (drag.current?.moved) {
                suppressClick.current = true;
                setTimeout(() => (suppressClick.current = false), 0);
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              drag.current = null;
              setDragId(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragId(null);
            }}
          >
            <button
              className="tab-select"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls="document-panel"
              aria-selected={t.id === activeId}
              tabIndex={t.id === activeId ? 0 : -1}
              onClick={() => {
                if (!suppressClick.current) onSelect(t.id);
              }}
              title={t.name}
              aria-label={`${t.name}${t.dirty ? ", unsaved changes" : ""}`}
            >
              <span className="tab-name">{t.name}</span>
              {t.dirty && (
                <span className="tab-dot" aria-hidden="true">
                  •
                </span>
              )}
            </button>
            <button
              className="tab-close"
              tabIndex={t.id === activeId ? 0 : -1}
              title="Close tab (⌘W)"
              aria-label={`Close ${t.name}`}
              onClick={() => onClose(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="tab-new"
        onClick={onNew}
        title="New tab (⌘T)"
        aria-label="New document"
      >
        +
      </button>
    </div>
  );
}
