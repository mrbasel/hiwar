import { cn } from "#lib/format";

// A filter that narrows results, such as the channel picker. Active when it
// is set to something other than its default, and pressed while its popup is open.
export const chipClass = (active = false) =>
  cn(
    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors duration-150 data-popup-open:border-accent [&_svg]:size-3.5",
    active
      ? "border-accent bg-accent-wash font-medium text-accent"
      : "border-rule bg-surface text-muted hover:border-ink/40 hover:text-ink",
  );
