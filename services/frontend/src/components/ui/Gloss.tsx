import type { ReactNode } from "react";
import { cn } from "#lib/format";

// Rawi's one signature layout: what was said, read in the main column, with
// where it was said kept in the start margin like a gloss in a manuscript.
// On narrow screens the margin folds above the text.
export function Gloss({
  margin,
  children,
  className,
}: {
  margin: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-5 sm:grid-cols-[4.5rem_1fr]", className)}>
      <div className="sm:pt-[0.3em] sm:text-end">{margin}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
