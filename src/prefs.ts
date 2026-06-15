import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";

const THEME_KEY = "mv.theme";
const ZOOM_KEY = "mv.zoom";
const SIDEBAR_KEY = "mv.sidebar";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

const clampZoom = (z: number) => Math.min(2.5, Math.max(0.6, Math.round(z * 100) / 100));

/** App preferences (theme, zoom, sidebar) persisted to localStorage. */
export function usePreferences() {
  const [theme, setTheme] = useState<ThemePref>(() => load(THEME_KEY, "system"));
  const [zoom, setZoomRaw] = useState<number>(() => load(ZOOM_KEY, 1));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => load(SIDEBAR_KEY, true));
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
  };
}
