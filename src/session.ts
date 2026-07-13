import type { Mode } from "./types";

const SESSION_KEY = "mv.session";

export type SessionState = {
  version: 1;
  /** Absolute paths of open, on-disk files (order = tab order). */
  paths: string[];
  activePath: string | null;
  mode: Mode;
  folderPath: string | null;
};

const EMPTY: SessionState = {
  version: 1,
  paths: [],
  activePath: null,
  mode: "preview",
  folderPath: null,
};

export function loadSession(): SessionState {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.paths)) return { ...EMPTY };
    return {
      version: 1,
      paths: parsed.paths.filter((p): p is string => typeof p === "string"),
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
      mode:
        parsed.mode === "edit" || parsed.mode === "split" || parsed.mode === "preview"
          ? parsed.mode
          : "preview",
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
