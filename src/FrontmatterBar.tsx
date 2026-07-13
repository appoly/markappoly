import {
  frontmatterTags,
  frontmatterTitle,
  parseFrontmatter,
} from "./frontmatter";

/** Compact chrome above the preview when a document has YAML frontmatter. */
export function FrontmatterBar({ source }: { source: string }) {
  const fm = parseFrontmatter(source);
  if (!fm) return null;

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
      {title && <div className="fm-title">{title}</div>}
      {description && <div className="fm-desc">{description}</div>}
      <div className="fm-meta">
        {date && <span className="fm-date">{date}</span>}
        {tags.map((t) => (
          <span key={t} className="fm-tag">
            {t}
          </span>
        ))}
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
