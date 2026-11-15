import { useCallback, useSyncExternalStore } from "react";
import { DEV } from "#lib/env";

// Shows the dev-only features under `vite dev`; switch off to see the site as
// it ships. Saved in localStorage, always off in builds.

const KEY = "dev-mode";
const listeners = new Set<() => void>();

// Runs before the first paint so highlights don't flash. Mirrors current().
export const devModeScript = `try{if(localStorage.getItem("${KEY}")==="off")delete document.documentElement.dataset.dev}catch(e){}`;

function current(): boolean {
  if (!DEV) return false;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDevMode() {
  const on = useSyncExternalStore(subscribe, current, () => DEV);
  const toggle = useCallback(() => {
    const next = !current();
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {}
    for (const listener of listeners) listener();
  }, []);
  return [on, toggle] as const;
}
