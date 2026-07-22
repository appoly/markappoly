import { useState } from "react";

type Data = Record<string, string | string[]>;

/**
 * Inline editor for frontmatter properties. Values keep their shape: lists stay
 * lists (edited comma-separated), true/false render as a checkbox, everything
 * else is plain text. Changes are written straight back into the document.
 */
export function PropertiesPanel({
  data,
  onChange,
  onClose,
}: {
  data: Data;
  onChange: (next: Data) => void;
  onClose: () => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const setValue = (key: string, value: string | string[]) => {
    onChange({ ...data, [key]: value });
  };

  const removeKey = (key: string) => {
    const next = { ...data };
    delete next[key];
    onChange(next);
  };

  const addProperty = () => {
    const key = newKey.trim();
    if (!key || !/^[A-Za-z0-9_-]+$/.test(key) || key in data) return;
    onChange({ ...data, [key]: newValue.trim() });
    setNewKey("");
    setNewValue("");
  };

  return (
    <div className="props-panel" aria-label="Document properties">
      <div className="props-head">
        <span>Properties</span>
        <button className="link-btn" onClick={onClose}>
          Done
        </button>
      </div>
      {Object.entries(data).map(([key, value]) => (
        <div className="props-row" key={key}>
          <span className="props-key" title={key}>
            {key}
          </span>
          {Array.isArray(value) ? (
            <input
              className="props-value"
              defaultValue={value.join(", ")}
              placeholder="comma, separated, list"
              onBlur={(e) =>
                setValue(
                  key,
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          ) : value === "true" || value === "false" ? (
            <input
              type="checkbox"
              className="props-check"
              checked={value === "true"}
              onChange={(e) => setValue(key, e.target.checked ? "true" : "false")}
            />
          ) : (
            <input
              className="props-value"
              defaultValue={value}
              onBlur={(e) => {
                if (e.target.value !== value) setValue(key, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          )}
          <button
            className="props-remove"
            title={`Remove ${key}`}
            aria-label={`Remove ${key}`}
            onClick={() => removeKey(key)}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="props-row props-add">
        <input
          className="props-key-input"
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addProperty();
          }}
        />
        <input
          className="props-value"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addProperty();
          }}
        />
        <button className="props-add-btn" onClick={addProperty} disabled={!newKey.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
