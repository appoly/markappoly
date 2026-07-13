import { useEffect, useMemo, useState } from "react";
import { Preview } from "./markdown";

/** Fullscreen slideshow: the document split on thematic breaks (`---`). */
export function PresentView({
  source,
  dark,
  basePath,
  onClose,
  blockRemoteImages,
  onOpenLocal,
}: {
  source: string;
  dark: boolean;
  basePath?: string;
  onClose: () => void;
  blockRemoteImages?: boolean;
  onOpenLocal?: (path: string) => void;
}) {
  const slides = useMemo(() => {
    const parts = source
      .replace(/^---\n[\s\S]*?\n---\n/, "") // drop YAML frontmatter if present
      .split(/\n[ \t]*-{3,}[ \t]*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [source];
  }, [source]);

  const [i, setI] = useState(0);
  const at = Math.min(i, slides.length - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setI((n) => Math.min(n + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setI((n) => Math.max(n - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  return (
    <div className="present" data-theme={dark ? "dark" : "light"}>
      <div
        className="present-stage"
        onClick={(e) => {
          const half = (e.currentTarget as HTMLElement).clientWidth / 2;
          if (e.clientX < half) setI((n) => Math.max(n - 1, 0));
          else setI((n) => Math.min(n + 1, slides.length - 1));
        }}
      >
        <div className="present-slide markdown-body">
          <Preview
            source={slides[at]}
            dark={dark}
            basePath={basePath}
            onToggleTask={() => {}}
            onOpenLocal={onOpenLocal}
            blockRemoteImages={blockRemoteImages}
          />
        </div>
      </div>
      <div className="present-bar">
        <button
          className="fmt"
          onClick={() => setI((n) => Math.max(n - 1, 0))}
          disabled={at === 0}
          title="Previous"
        >
          ‹
        </button>
        <span className="present-count">
          {at + 1} / {slides.length}
        </span>
        <button
          className="fmt"
          onClick={() => setI((n) => Math.min(n + 1, slides.length - 1))}
          disabled={at === slides.length - 1}
          title="Next"
        >
          ›
        </button>
        <button className="fmt" onClick={onClose} title="Exit (Esc)">
          ✕
        </button>
      </div>
    </div>
  );
}
