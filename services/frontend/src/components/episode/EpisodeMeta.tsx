import { clock } from "#lib/format";

// Show, date and length, above an episode's title.
export function EpisodeMeta({
  show,
  date,
  duration,
  className = "text-xs text-muted",
  hideDurationOnMobile = false,
}: {
  show: string;
  date: string;
  duration: number | null;
  className?: string;
  hideDurationOnMobile?: boolean;
}) {
  const sep = <span className="mx-1.5 text-faint">/</span>;
  return (
    <p className={className}>
      <span>{show.trim()}</span>
      {sep}
      <time dateTime={date} dir="ltr" className="whitespace-nowrap">
        {date}
      </time>
      {duration ? (
        <span className={hideDurationOnMobile ? "max-sm:hidden" : undefined}>
          {sep}
          <span dir="ltr">{clock(duration)}</span>
        </span>
      ) : null}
    </p>
  );
}
