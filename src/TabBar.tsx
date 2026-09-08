import { useRef } from "react";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void | Promise<void>;
  onNew: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
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
            className={"tab" + (t.id === activeId ? " active" : "")}
            role="presentation"
          >
            <button
              className="tab-select"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls="document-panel"
              aria-selected={t.id === activeId}
              tabIndex={t.id === activeId ? 0 : -1}
              onClick={() => onSelect(t.id)}
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
