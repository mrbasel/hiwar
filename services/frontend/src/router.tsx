import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Plain query strings (?q=…&mode=keyword) rather than the router's default
// JSON values, so links from the old pages keep working and a query like
// "2024" stays a string.
function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

function stringifySearch(search: Record<string, unknown>): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === "") continue;
    url.set(key, String(value));
  }
  const query = url.toString();
  return query ? `?${query}` : "";
}

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    parseSearch,
    stringifySearch,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
