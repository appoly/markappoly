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
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={"tab" + (t.id === activeId ? " active" : "")}
          onClick={() => onSelect(t.id)}
          title={t.name}
        >
          <span className="tab-name">{t.name}</span>
          {t.dirty && <span className="tab-dot">•</span>}
          <button
            className="tab-close"
            title="Close tab (⌘W)"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="New tab (⌘T)">
        +
      </button>
    </div>
  );
}
