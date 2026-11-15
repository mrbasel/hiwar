import { Link } from "@tanstack/react-router";
import { buttonClass } from "#components/ui/Button";
import { arabic, cn } from "#lib/format";

// Previous and next are links to the same search's other pages, so they can be
// opened in a new tab and the router preloads them on hover.
export function Pager({ page, pages, className }: { page: number; pages: number; className?: string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="الصفحات" className={cn("flex items-center gap-4 text-sm text-muted", className)}>
      <PageLink page={page - 1} disabled={page <= 1}>
        السابق
      </PageLink>
      <span>
        صفحة {arabic(page)} من {arabic(pages)}
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
      <span aria-disabled className={buttonClass("secondary", "sm")}>
        {children}
      </span>
    );
  }
  return (
    <Link to="/" search={(prev) => ({ ...prev, page })} className={buttonClass("secondary", "sm")}>
      {children}
    </Link>
  );
}
