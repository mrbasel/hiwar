import { Link } from "@tanstack/react-router";
import { arabic, cn } from "#lib/format";

const step =
  "rounded-md border border-rule bg-surface px-4 py-1.5 text-[0.9rem] font-medium text-ink no-underline";

// Previous and next are links to the same search's other pages, so they can be
// opened in a new tab and the router preloads them on hover.
export function Pager({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-4 text-[0.9rem] text-muted">
      <PageLink page={page - 1} disabled={page <= 1}>
        السابق
      </PageLink>
      <span>
        {arabic(page)} من {arabic(pages)}
      </span>
      <PageLink page={page + 1} disabled={page >= pages}>
        التالي
      </PageLink>
    </nav>
  );
}

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: string }) {
  if (disabled) {
    return (
      <span aria-disabled className={cn(step, "opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link to="/" search={(prev) => ({ ...prev, page })} className={step}>
      {children}
    </Link>
  );
}
