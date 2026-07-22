import { useState } from "react";
import {
  frontmatterTags,
  frontmatterTitle,
  parseFrontmatter,
  replaceFrontmatter,
} from "./frontmatter";
import { PropertiesPanel } from "./PropertiesPanel";

/**
 * Compact chrome above the preview when a document has YAML frontmatter.
 * "Edit" opens the properties panel, which writes changes back to the source.
 */
export function FrontmatterBar({
  source,
  onChangeSource,
  onTagClick,
}: {
  source: string;
  onChangeSource?: (next: string) => void;
  onTagClick?: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const fm = parseFrontmatter(source);
  if (!fm) return null;

  if (editing && onChangeSource) {
    return (
      <PropertiesPanel
        data={fm.data}
        onChange={(next) => onChangeSource(replaceFrontmatter(source, next))}
        onClose={() => setEditing(false)}
      />
    );
  }

  const title = frontmatterTitle(fm.data);
  const tags = frontmatterTags(fm.data);
  const date = typeof fm.data.date === "string" ? fm.data.date : null;
  const description =
    typeof fm.data.description === "string"
      ? fm.data.description
      : typeof fm.data.summary === "string"
        ? fm.data.summary
        : null;

  // Prefer known fields; otherwise show a short key/value summary.
  const extras = Object.entries(fm.data).filter(
    ([k]) =>
      !["title", "Title", "name", "Name", "tags", "Tags", "keywords", "Keywords", "date", "description", "summary"].includes(
        k,
      ),
  );

  if (!title && !tags.length && !date && !description && extras.length === 0) {
    return null;
  }

  return (
    <aside className="frontmatter-bar" aria-label="Document metadata">
      {onChangeSource && (
        <button className="fm-edit link-btn" onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      {title && <div className="fm-title">{title}</div>}
      {description && <div className="fm-desc">{description}</div>}
      <div className="fm-meta">
        {date && <span className="fm-date">{date}</span>}
        {tags.map((t) =>
          onTagClick ? (
            <button key={t} className="fm-tag fm-tag-click" onClick={() => onTagClick(t)}>
              {t}
            </button>
          ) : (
            <span key={t} className="fm-tag">
              {t}
            </span>
          ),
        )}
        {extras.slice(0, 6).map(([k, v]) => (
          <span key={k} className="fm-kv">
            <span className="fm-k">{k}</span>
            {Array.isArray(v) ? v.join(", ") : String(v)}
          </span>
        ))}
      </div>
    </aside>
  );
}
