import { useEffect, useState } from "react";

/**
 * Track which heading is currently in view inside a scroll container.
 * Returns the active element `id` (slug), or null when none apply.
 */
export function useScrollSpy(
  container: HTMLElement | null,
  /** Re-bind when the document content / mode changes. */
  deps: unknown[],
  enabled: boolean,
): string | null {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !container) {
      setActiveSlug(null);
      return;
    }

    const headings = Array.from(
      container.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
    );
    if (headings.length === 0) {
      setActiveSlug(null);
      return;
    }

    // Pick the last heading whose top is above ~25% of the viewport.
    const update = () => {
      const rootTop = container.getBoundingClientRect().top;
      const threshold = rootTop + container.clientHeight * 0.25;
      let current: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const top = h.getBoundingClientRect().top;
        if (top <= threshold) current = h.id;
        else break;
      }
      setActiveSlug(current);
    };

    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, enabled, ...deps]);

  return activeSlug;
}
