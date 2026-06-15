import { useEffect, type ReactNode } from "react";
import type { usePreferences } from "./prefs";

type Prefs = ReturnType<typeof usePreferences>;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="set-row">
      <span className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`switch${checked ? " on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="seg-choice" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? "active" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Settings({ prefs, onClose }: { prefs: Prefs; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-label="Settings">
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <section className="set-section">
            <h3>Editor</h3>
            <Row label="Focus mode" hint="Dim all but the current paragraph">
              <Toggle checked={prefs.focusMode} onChange={prefs.setFocusMode} />
            </Row>
            <Row label="Typewriter scrolling" hint="Keep the active line centred">
              <Toggle checked={prefs.typewriter} onChange={prefs.setTypewriter} />
            </Row>
            <Row label="Spellcheck">
              <Toggle checked={prefs.spellcheck} onChange={prefs.setSpellcheck} />
            </Row>
            <Row label="Paste HTML as Markdown" hint="Convert pasted rich text">
              <Toggle checked={prefs.pasteAsMarkdown} onChange={prefs.setPasteAsMarkdown} />
            </Row>
          </section>

          <section className="set-section">
            <h3>Reading</h3>
            <Row label="Theme">
              <Choice
                value={prefs.theme}
                onChange={prefs.setTheme}
                options={[
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ]}
              />
            </Row>
            <Row label="Width">
              <Choice
                value={prefs.readingWidth}
                onChange={prefs.setReadingWidth}
                options={[
                  ["narrow", "Narrow"],
                  ["normal", "Normal"],
                  ["wide", "Wide"],
                ]}
              />
            </Row>
            <Row label="Font">
              <Choice
                value={prefs.readingFont}
                onChange={prefs.setReadingFont}
                options={[
                  ["sans", "Sans"],
                  ["serif", "Serif"],
                  ["mono", "Mono"],
                ]}
              />
            </Row>
            <Row label="Line spacing">
              <Choice
                value={prefs.lineSpacing}
                onChange={prefs.setLineSpacing}
                options={[
                  ["tight", "Tight"],
                  ["normal", "Normal"],
                  ["relaxed", "Relaxed"],
                ]}
              />
            </Row>
          </section>

          <section className="set-section">
            <h3>Custom CSS</h3>
            <p className="set-note">
              Styles the preview. Target <code>.markdown-body</code>.
            </p>
            <textarea
              className="set-css"
              value={prefs.customCss}
              spellCheck={false}
              placeholder=".markdown-body { font-size: 17px; }"
              onChange={(e) => prefs.setCustomCss(e.target.value)}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
