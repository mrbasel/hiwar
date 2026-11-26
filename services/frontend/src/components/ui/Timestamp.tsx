import { clock, cn } from "#lib/format";

// Where a moment starts in its episode, linking to that second on YouTube.
// Digits stay Latin and left-to-right, as on the player it opens.
export function Timestamp({
  seconds,
  href,
  className,
}: {
  seconds: number;
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "-mx-1.5 inline-block rounded-mark px-1.5 text-sm font-medium whitespace-nowrap text-accent tabular-nums underline decoration-rule underline-offset-4 hover:decoration-current transition-colors duration-150 [direction:ltr] [unicode-bidi:isolate] hover:bg-accent-wash",
        className,
      )}
    >
      {clock(seconds)}
    </a>
  );
}
