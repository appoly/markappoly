import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";
export type ReadingWidth = "narrow" | "normal" | "wide";
export type ReadingFont = "sans" | "serif" | "mono";
export type LineSpacing = "tight" | "normal" | "relaxed";

const THEME_KEY = "mv.theme";
const ZOOM_KEY = "mv.zoom";
const SIDEBAR_KEY = "mv.sidebar";
const FOCUS_KEY = "mv.focusMode";
const TYPEWRITER_KEY = "mv.typewriter";
const SPELLCHECK_KEY = "mv.spellcheck";
const PASTE_MD_KEY = "mv.pasteAsMarkdown";
const READING_WIDTH_KEY = "mv.readingWidth";
const READING_FONT_KEY = "mv.readingFont";
const LINE_SPACING_KEY = "mv.lineSpacing";
const CUSTOM_CSS_KEY = "mv.customCss";

const WIDTHS: Record<ReadingWidth, string> = {
  narrow: "600px",
  normal: "760px",
  wide: "920px",
};
const FONTS: Record<ReadingFont, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: '"SF Mono", ui-monospace, Menlo, monospace',
};
const LINE_HEIGHTS: Record<LineSpacing, string> = {
  tight: "1.45",
  normal: "1.65",
  relaxed: "1.9",
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

const clampZoom = (z: number) => Math.min(2.5, Math.max(0.6, Math.round(z * 100) / 100));

/** App preferences persisted to localStorage and applied to the DOM. */
export function usePreferences() {
  const [theme, setTheme] = useState<ThemePref>(() => load(THEME_KEY, "system"));
  const [zoom, setZoomRaw] = useState<number>(() => load(ZOOM_KEY, 1));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => load(SIDEBAR_KEY, true));
  const [focusMode, setFocusMode] = useState<boolean>(() => load(FOCUS_KEY, false));
  const [typewriter, setTypewriter] = useState<boolean>(() => load(TYPEWRITER_KEY, false));
  const [spellcheck, setSpellcheck] = useState<boolean>(() => load(SPELLCHECK_KEY, true));
  const [pasteAsMarkdown, setPasteAsMarkdown] = useState<boolean>(() => load(PASTE_MD_KEY, true));
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>(() =>
    load(READING_WIDTH_KEY, "normal"),
  );
  const [readingFont, setReadingFont] = useState<ReadingFont>(() => load(READING_FONT_KEY, "sans"));
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(() => load(LINE_SPACING_KEY, "normal"));
  const [customCss, setCustomCss] = useState<string>(() => load(CUSTOM_CSS_KEY, ""));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    // Sync the native window appearance so the macOS vibrancy material (and
    // Windows acrylic) follows the in-app theme instead of the OS appearance.
    // Without this, choosing Dark while the OS is Light leaves the chrome's
    // translucent panels over a light material, rendering near-invisible.
    getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch((e) => console.warn("Failed to sync native window theme:", e));
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--zoom", String(zoom));
    localStorage.setItem(ZOOM_KEY, JSON.stringify(zoom));
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  // Reading typography → CSS variables consumed by .markdown-body.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--reading-max-width", WIDTHS[readingWidth]);
    root.style.setProperty("--reading-font", FONTS[readingFont]);
    root.style.setProperty("--reading-line-height", LINE_HEIGHTS[lineSpacing]);
    localStorage.setItem(READING_WIDTH_KEY, JSON.stringify(readingWidth));
    localStorage.setItem(READING_FONT_KEY, JSON.stringify(readingFont));
    localStorage.setItem(LINE_SPACING_KEY, JSON.stringify(lineSpacing));
  }, [readingWidth, readingFont, lineSpacing]);

  // User CSS → a single <style> element that styles the preview.
  useEffect(() => {
    const id = "mv-custom-css";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = customCss;
    localStorage.setItem(CUSTOM_CSS_KEY, JSON.stringify(customCss));
  }, [customCss]);

  useEffect(() => {
    localStorage.setItem(FOCUS_KEY, JSON.stringify(focusMode));
  }, [focusMode]);
  useEffect(() => {
    localStorage.setItem(TYPEWRITER_KEY, JSON.stringify(typewriter));
  }, [typewriter]);
  useEffect(() => {
    localStorage.setItem(SPELLCHECK_KEY, JSON.stringify(spellcheck));
  }, [spellcheck]);
  useEffect(() => {
    localStorage.setItem(PASTE_MD_KEY, JSON.stringify(pasteAsMarkdown));
  }, [pasteAsMarkdown]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const setZoom = useCallback((z: number) => setZoomRaw(clampZoom(z)), []);
  const zoomIn = useCallback(() => setZoomRaw((z) => clampZoom(z + 0.1)), []);
  const zoomOut = useCallback(() => setZoomRaw((z) => clampZoom(z - 0.1)), []);
  const zoomReset = useCallback(() => setZoomRaw(1), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((s) => !s), []);

  const dark = theme === "dark" || (theme === "system" && systemDark);

  return {
    theme,
    setTheme,
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    zoomReset,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    dark,
    focusMode,
    setFocusMode,
    typewriter,
    setTypewriter,
    spellcheck,
    setSpellcheck,
    pasteAsMarkdown,
    setPasteAsMarkdown,
    readingWidth,
    setReadingWidth,
    readingFont,
    setReadingFont,
    lineSpacing,
    setLineSpacing,
    customCss,
    setCustomCss,
  };
}
