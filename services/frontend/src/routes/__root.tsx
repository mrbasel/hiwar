import { DirectionProvider } from "@base-ui/react/direction-provider";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import { DEV } from "#lib/env";
import { themeScript } from "#lib/theme";
import styles from "#styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "بحث في البودكاست" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
    scripts: [{ children: themeScript }],
  }),
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <Document>
      <QueryClientProvider client={queryClient}>
        <DirectionProvider direction="rtl">
          <Outlet />
        </DirectionProvider>
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <TanStackRouterDevtools position="bottom-right" />
      </QueryClientProvider>
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-dev={DEV || undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Its own stacking context, so Base UI's portalled popups sit above the page. */}
        <div className="isolate">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-184 px-4 py-16">
      <h1 className="mb-2 text-2xl font-semibold">الصفحة غير موجودة</h1>
      <Link to="/" className="text-signal">
        العودة إلى البحث
      </Link>
    </main>
  );
}
