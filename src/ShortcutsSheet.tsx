import { Modal } from "./Modal";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Show ⌘/⇧/⌥ chords as Ctrl+Shift+Alt on Windows and Linux. */
function chord(keys: string): string {
  if (IS_MAC) return keys;
  return keys
    .replace(/⌘/g, "Ctrl+")
    .replace(/⇧/g, "Shift+")
    .replace(/⌥/g, "Alt+");
}

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Files and tabs",
    items: [
      ["Open", "⌘O"],
      ["Open folder", "⌘⇧O"],
      ["New note", "⌘N"],
      ["Today's note", "⌘⇧D"],
      ["Save", "⌘S"],
      ["Reload from disk", "⌘R"],
      ["New tab", "⌘T"],
      ["Close tab", "⌘W"],
      ["Reopen closed tab", "⌘⇧T"],
      ["Bookmark", "⌘D"],
    ],
  },
  {
    title: "Find and navigate",
    items: [
      ["Quick switcher", "⌘P"],
      ["Commands", "⌘K"],
      ["Find in document", "⌘F"],
      ["Back / Forward", "⌘[ / ⌘]"],
      ["Next / previous change", "F7 / ⇧F7"],
      ["Graph", "⌘⇧G"],
    ],
  },
  {
    title: "View",
    items: [
      ["Edit / Preview", "⌘E"],
      ["Split view", "⌘⇧E"],
      ["Present", "⌘⇧P"],
      ["Toggle sidebar", "⌘\\"],
      ["Light / Dark", "⌘⇧L"],
      ["Zoom", "⌘+ / ⌘- / ⌘0"],
      ["Settings", "⌘,"],
      ["This list", "⌘/"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["Bold / Italic", "⌘B / ⌘I"],
      ["Link", "⌘K"],
      ["Insert a block", "/"],
      ["Link a note", "[["],
    ],
  },
];

/** ⌘/ — every shortcut on one sheet. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} className="shortcuts-sheet">
      <header className="modal-head">
        <h2>Keyboard Shortcuts</h2>
        <button
          className="icon-btn"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          data-autofocus
        >
          ✕
        </button>
      </header>
      <div className="modal-body shortcuts-grid">
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcuts-group">
            <h3>{g.title}</h3>
            <dl>
              {g.items.map(([label, keys]) => (
                <div key={label} className="shortcut-row">
                  <dt>{label}</dt>
                  <dd>
                    <kbd>{chord(keys)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
