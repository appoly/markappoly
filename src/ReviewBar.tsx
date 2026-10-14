import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewComment } from "./review";

// ----- Comment storage -----

const memoryComments = new Map<string, ReviewComment[]>();
const storageKey = (key: string) => `mv.comments:${key}`;

function loadComments(key: string): ReviewComment[] {
  if (!key.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(key))
    return memoryComments.get(key) ?? [];
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as ReviewComment[]) : [];
  } catch {
    return [];
  }
}

function storeComments(key: string, comments: ReviewComment[]) {
  if (!key.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(key)) {
    memoryComments.set(key, comments);
    return;
  }
  try {
    if (comments.length) localStorage.setItem(storageKey(key), JSON.stringify(comments));
    else localStorage.removeItem(storageKey(key));
  } catch {
    /* storage full or unavailable: comments stay for this session only */
  }
}

/**
 * Review comments for a document, kept per file path (or per tab for unsaved
 * documents) so they survive closing the tab and relaunching.
 */
export function useComments(key: string) {
  const [comments, setState] = useState<ReviewComment[]>(() => loadComments(key));
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
    setState(loadComments(key));
  }, [key]);
  const setComments = useCallback((next: ReviewComment[]) => {
    storeComments(keyRef.current, next);
    setState(next);
  }, []);
  return [comments, setComments] as const;
}

// ----- Review bar -----

export type PlacedComment = ReviewComment & { at: number };

export function ReviewBar({
  summary,
  position,
  onPrev,
  onNext,
  diffOpen,
  onToggleDiff,
  onMarkReviewed,
  comments,
  onJumpComment,
  onDeleteComment,
  onCopyFeedback,
  onClearComments,
}: {
  /** e.g. "3 changes in 2 sections", or null when nothing changed. */
  summary: string | null;
  /** e.g. "2 of 3 · Setup" for the change last stepped to. */
  position: string | null;
  onPrev: () => void;
  onNext: () => void;
  diffOpen: boolean;
  onToggleDiff: () => void;
  onMarkReviewed: () => void;
  comments: PlacedComment[];
  onJumpComment: (id: string) => void;
  onDeleteComment: (id: string) => void;
  onCopyFeedback: () => void;
  onClearComments: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setListOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setListOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [listOpen]);

  return (
    <div className="format-bar review-bar" role="region" aria-label="Review">
      {summary && (
        <>
          <span className="review-dot" aria-hidden />
          <span className="review-summary">
            Changed since you last read it · {summary}
          </span>
          <button className="fmt" title="Previous change (⇧F7)" aria-label="Previous change" onClick={onPrev}>
            ↑
          </button>
          <button className="fmt" title="Next change (F7)" aria-label="Next change" onClick={onNext}>
            ↓
          </button>
          {position && <span className="review-position">{position}</span>}
        </>
      )}
      <span className="spacer" />
      {comments.length > 0 && (
        <div className="menu-wrap" ref={wrap}>
          <button
            className="fmt"
            aria-expanded={listOpen}
            onClick={() => setListOpen((o) => !o)}
          >
            Comments ({comments.length})
          </button>
          {listOpen && (
            <div className="menu-pop align-right review-comments" role="dialog" aria-label="Comments">
              <ul>
                {[...comments]
                  .sort((a, b) => a.at - b.at)
                  .map((c) => (
                    <li key={c.id} className={c.at < 0 ? "outdated" : undefined}>
                      <button
                        className="review-comment-jump"
                        disabled={c.at < 0}
                        onClick={() => {
                          onJumpComment(c.id);
                          setListOpen(false);
                        }}
                      >
                        {c.quote && <q>{c.quote}</q>}
                        <span>{c.text}</span>
                        {c.at < 0 && <em>Passage no longer in the document</em>}
                      </button>
                      <button
                        className="link-btn"
                        aria-label="Delete comment"
                        title="Delete comment"
                        onClick={() => onDeleteComment(c.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
              <div className="review-comments-foot">
                <button className="link-btn" onClick={onClearComments}>
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {comments.length > 0 && (
        <button
          className="fmt"
          title="Copy every comment as Markdown, with its section and quoted passage, to paste back to the author or an AI agent"
          onClick={onCopyFeedback}
        >
          Copy feedback
        </button>
      )}
      {summary && (
        <>
          <button className="fmt" aria-pressed={diffOpen} onClick={onToggleDiff}>
            {diffOpen ? "Back to preview" : "Source diff"}
          </button>
          <button className="fmt review-done" onClick={onMarkReviewed}>
            Mark as reviewed
          </button>
        </>
      )}
    </div>
  );
}

// ----- Selection → comment -----

/**
 * Select text in the preview to get a small "Comment" button; it opens a note
 * field anchored to the selection. ⌘/Ctrl+Enter saves, Escape cancels.
 */
export function CommentComposer({
  root,
  lineForSelection,
  onAdd,
}: {
  root: HTMLElement | null;
  lineForSelection: (sel: Selection) => number | null;
  onAdd: (c: { line: number; quote: string; text: string }) => void;
}) {
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    line: number;
    quote: string;
  } | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root) return;
    const update = () => {
      if (writing) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setAnchor(null);
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return setAnchor(null);
      const quote = sel.toString().trim();
      const line = lineForSelection(sel);
      if (!quote || line == null) return setAnchor(null);
      const rect = range.getBoundingClientRect();
      setAnchor({
        x: Math.min(rect.right, window.innerWidth - 120),
        y: rect.bottom + 6,
        line,
        quote: quote.length > 400 ? quote.slice(0, 400) + "…" : quote,
      });
    };
    const onUp = () => requestAnimationFrame(update);
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      if (!writing) setAnchor(null);
    };
    root.addEventListener("mouseup", onUp);
    root.addEventListener("keyup", onUp);
    document.addEventListener("mousedown", onDown);
    const scroller = root.closest(".content");
    const hide = () => !writing && setAnchor(null);
    scroller?.addEventListener("scroll", hide);
    return () => {
      root.removeEventListener("mouseup", onUp);
      root.removeEventListener("keyup", onUp);
      document.removeEventListener("mousedown", onDown);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [root, writing, lineForSelection]);

  if (!anchor) return null;
  const cancel = () => {
    setWriting(false);
    setText("");
    setAnchor(null);
  };
  const save = () => {
    if (text.trim()) onAdd({ line: anchor.line, quote: anchor.quote, text: text.trim() });
    window.getSelection()?.removeAllRanges();
    cancel();
  };
  const style = {
    left: Math.max(12, anchor.x - (writing ? 300 : 0)),
    top: Math.min(anchor.y, window.innerHeight - (writing ? 170 : 40)),
  };

  return (
    <div className={`comment-composer${writing ? " writing" : ""}`} style={style} ref={box}>
      {writing ? (
        <>
          <textarea
            autoFocus
            value={text}
            placeholder="What should change here?"
            aria-label="Comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
          <div className="comment-composer-actions">
            <span>⌘↩ to save</span>
            <button className="link-btn" onClick={cancel}>
              Cancel
            </button>
            <button className="primary-action" onClick={save} disabled={!text.trim()}>
              Comment
            </button>
          </div>
        </>
      ) : (
        <button className="comment-composer-open" onClick={() => setWriting(true)}>
          Comment
        </button>
      )}
    </div>
  );
}
