import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "#lib/format";

// Links and chapter times (01:23:07) in the text, the times to that second on YouTube.
const TOKEN = /(https?:\/\/[^\s]+)|(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])/g;

function seconds(time: string): number {
  return time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function linkify(text: string, videoUrl: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out.push(text.slice(last, m.index));
    const [token, url, time = ""] = m;
    out.push(
      <a
        key={m.index}
        href={url ?? `${videoUrl}&t=${seconds(time)}s`}
        target="_blank"
        rel="noopener"
        dir="ltr"
        className="text-accent underline decoration-rule underline-offset-4 hover:decoration-current [unicode-bidi:isolate]"
      >
        {token}
      </a>,
    );
    last = m.index + token.length;
  }
  out.push(text.slice(last));
  return out;
}

// Clamped to a few lines; the toggle shows only if there is more to read.
export function EpisodeDescription({ text, videoUrl }: { text: string; videoUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [open]);

  if (!text) return <p className="text-muted">لا يوجد وصف لهذه الحلقة.</p>;
  return (
    <>
      <div
        ref={ref}
        id="description-text"
        dir="auto"
        className={cn(
          "text-base leading-relaxed wrap-anywhere whitespace-pre-line text-muted",
          !open && "line-clamp-6",
        )}
      >
        {linkify(text, videoUrl)}
      </div>
      {(overflows || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="description-text"
          onClick={() => setOpen(!open)}
          className="mt-1 cursor-pointer font-semibold text-ink hover:underline hover:decoration-rule hover:underline-offset-4"
        >
          {open ? "أقل" : "… المزيد"}
        </button>
      )}
    </>
  );
}
