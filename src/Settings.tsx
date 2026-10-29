import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import type { usePreferences } from "./prefs";

type Prefs = ReturnType<typeof usePreferences>;

const RowLabel = createContext("");

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <RowLabel.Provider value={id}>
      <div className="set-row">
        <span className="set-label" id={id}>
          {label}
          {hint && <span className="set-hint">{hint}</span>}
        </span>
        {children}
      </div>
    </RowLabel.Provider>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`switch${checked ? " on" : ""}`}
      aria-labelledby={useContext(RowLabel)}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
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
    <div
      className="seg-choice"
      role="radiogroup"
      aria-labelledby={useContext(RowLabel)}
      onKeyDown={(e) => {
        const buttons = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
        );
        const index = buttons.indexOf(e.target as HTMLButtonElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : ["ArrowRight", "ArrowDown"].includes(e.key)
                ? (index + 1) % buttons.length
                : ["ArrowLeft", "ArrowUp"].includes(e.key)
                  ? (index - 1 + buttons.length) % buttons.length
                  : -1;
        if (next >= 0) {
          e.preventDefault();
          buttons[next].focus();
          onChange(options[next][0]);
        }
      }}
    >
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          tabIndex={value === v ? 0 : -1}
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

type AgentStatus = {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  error: string | null;
};

/** Hooks in Claude Code, Codex and Cursor that open the Markdown they write. */
function AgentsSection() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  // One config write at a time; a second click mid-write is ignored.
  const busy = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(
    () =>
      invoke<AgentStatus[]>("agent_integrations_status")
        .then(setAgents)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (id: string, enabled: boolean) => {
    busy.current = true;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await invoke("set_agent_integration", { id, enabled });
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: String(e) }));
    }
    await refresh();
    busy.current = false;
  };

  if (agents.length === 0) return null;
  return (
    <section className="set-section">
      <h3>Agents</h3>
      <p className="set-note">
        When an agent writes a Markdown file, it opens here, with changes
        highlighted.
      </p>
      {agents.map((a) => {
        const error = errors[a.id] ?? a.error;
        return (
          <div key={a.id}>
            <Row
              label={a.name}
              hint={
                !a.installed
                  ? "Not installed"
                  : a.id === "codex" && a.enabled
                    ? "Approve the hook once with /hooks in Codex"
                    : undefined
              }
            >
              <Toggle
                checked={a.enabled}
                disabled={!a.installed}
                onChange={(v) => {
                  if (!busy.current) void toggle(a.id, v);
                }}
              />
            </Row>
            {error && <p className="set-error">{error}</p>}
          </div>
        );
      })}
    </section>
  );
}

export function Settings({
  prefs,
  onClose,
}: {
  prefs: Prefs;
  onClose: () => void;
}) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <header className="modal-head">
        <h2>Settings</h2>
        <button
          className="icon-btn"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="modal-body">
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
          <Row
            label="Highlight outside changes"
            hint="Show what changed since you last read a file"
          >
            <Toggle
              checked={prefs.trackChanges}
              onChange={prefs.setTrackChanges}
            />
          </Row>
        </section>

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
            <Toggle
              checked={prefs.pasteAsMarkdown}
              onChange={prefs.setPasteAsMarkdown}
            />
          </Row>
          <Row
            label="Block remote images"
            hint="Don't load images over the network"
          >
            <Toggle
              checked={prefs.blockRemoteImages}
              onChange={prefs.setBlockRemoteImages}
            />
          </Row>
          <Row
            label="Autosave"
            hint="Save changes a moment after you stop typing"
          >
            <Toggle checked={prefs.autosave} onChange={prefs.setAutosave} />
          </Row>
        </section>

        <section className="set-section">
          <h3>Notes and templates</h3>
          <Row label="Templates folder" hint="Notes here appear in New Note…">
            <input
              className="set-text"
              aria-label="Templates folder"
              value={prefs.templatesFolder}
              spellCheck={false}
              placeholder="Templates"
              onChange={(e) => prefs.setTemplatesFolder(e.target.value)}
            />
          </Row>
          <Row
            label="Daily notes folder"
            hint="Blank keeps daily notes in the folder root"
          >
            <input
              className="set-text"
              aria-label="Daily notes folder"
              value={prefs.dailyFolder}
              spellCheck={false}
              placeholder="(root)"
              onChange={(e) => prefs.setDailyFolder(e.target.value)}
            />
          </Row>
        </section>

        <AgentsSection />

        <details className="set-section advanced-settings">
          <summary>Advanced styling</summary>
          <p className="set-note">
            Styles the preview. Target <code>.markdown-body</code>.
          </p>
          <textarea
            className="set-css"
            aria-label="Custom CSS"
            value={prefs.customCss}
            spellCheck={false}
            placeholder=".markdown-body { font-size: 17px; }"
            onChange={(e) => prefs.setCustomCss(e.target.value)}
          />
        </details>
      </div>
    </Modal>
  );
}
