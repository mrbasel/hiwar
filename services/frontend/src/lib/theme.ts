import { useCallback, useSyncExternalStore } from "react";

// Light/dark theme: follows the system until the user picks one, then
// remembers the choice in localStorage.

export type Theme = "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

// Runs in <head> before the first paint, so a saved theme applies without a
// flash. Kept in sync with saved() below.
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

function saved(): Theme | null {
  try {
    const theme = localStorage.getItem(KEY);
    return theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

const system = () => matchMedia("(prefers-color-scheme: dark)");

function current(): Theme {
  return saved() ?? (system().matches ? "dark" : "light");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = system();
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    document.documentElement.dataset.theme = next;
    for (const listener of listeners) listener();
  }, []);
  return [theme, toggle] as const;
}
