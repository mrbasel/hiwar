import { Collapsible } from "@base-ui/react/collapsible";
import { type ReactNode, useState } from "react";
import type { Episode, SearchHit } from "#api/search";
import { arabic, clock, cn } from "#lib/format";

const BADGES = { keyword: "Keyword", semantic: "Semantic" } as const;

const toggleClass =
  "order-1 my-2 block cursor-pointer rounded border border-rule px-3 py-0.5 text-[0.85rem] font-medium text-signal hover:border-signal";

// One episode, with the sections of it that matched on this page.
export function EpisodeCard({ episode, hits }: { episode: Episode; hits: SearchHit[] }) {
  // Hybrid results say which search found them; label the episode with every
  // search that found one of its sections on this page.
  const via = new Set(hits.flatMap((h) => h.matched_by ?? []));
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(!episode.has_transcript);

  return (
    <article className="mb-4 rounded-lg border border-rule bg-surface px-[1.15rem] pt-4 pb-2.5">
      <header>
        <h2 className="m-0 text-lg leading-snug font-semibold">
          <a
            href={episode.url}
            target="_blank"
            rel="noopener"
            className="no-underline hover:underline"
            dangerouslySetInnerHTML={{ __html: episode.title_html }}
          />
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-4 text-[0.85rem] text-muted">
          <span>{episode.show.trim()}</span>
          <time dateTime={episode.date}>{episode.date}</time>
          {episode.duration ? <span>{clock(episode.duration)}</span> : null}
          <span className="inline-flex gap-1">
            {(["keyword", "semantic"] as const)
              .filter((m) => via.has(m))
              .map((m) => (
                <Badge
                  key={m}
                  className={m === "keyword" ? "bg-keyword-bg text-keyword" : "bg-semantic-bg text-signal"}
                >
                  {BADGES[m]}
                </Badge>
              ))}
            {!episode.has_transcript && <Badge>بدون نص</Badge>}
          </span>
        </p>
      </header>

      {/* Both toggles sit in one row, with their panels below it. */}
      <div className="flex flex-wrap gap-x-2">
        <Collapsible.Root open={sectionsOpen} onOpenChange={setSectionsOpen} className="contents">
          <Collapsible.Trigger className={toggleClass}>
            {sectionsOpen ? "أخفِ الأجزاء" : `اعرض الأجزاء المطابقة (${arabic(hits.length)})`}
          </Collapsible.Trigger>
          <Collapsible.Panel className="order-4 basis-full">
            {hits.map((hit) => (
              <Section key={hit.section.id} hit={hit} />
            ))}
          </Collapsible.Panel>
        </Collapsible.Root>
        {/* Without a transcript, the description is all there is to show. */}
        {episode.description_html && (
          <Collapsible.Root open={descOpen} onOpenChange={setDescOpen} className="contents">
            <Collapsible.Trigger className={toggleClass}>
              {descOpen ? "أخفِ الوصف" : "اعرض الوصف"}
            </Collapsible.Trigger>
            <Collapsible.Panel
              className="order-3 mb-2.5 basis-full text-[0.9rem] leading-relaxed wrap-anywhere whitespace-pre-line text-muted"
              dangerouslySetInnerHTML={{ __html: episode.description_html }}
            />
          </Collapsible.Root>
        )}
      </div>
    </article>
  );
}

function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("rounded-full border border-current px-2 text-xs leading-normal", className)}>
      {children}
    </span>
  );
}

function TimeLink({ seconds, href, className }: { seconds: number; href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={cn(
        "text-[0.85rem] font-semibold whitespace-nowrap text-signal tabular-nums no-underline [direction:ltr] [unicode-bidi:isolate] hover:underline",
        className,
      )}
    >
      {clock(seconds)}
    </a>
  );
}

// Semantic-only hits have no moments or snippet beyond the section's opening.
function Section({ hit }: { hit: SearchHit }) {
  const { section } = hit;
  return (
    <div className="border-t border-rule pt-3 pb-2 first:border-t-0">
      <h3 className="mb-1 flex items-baseline gap-2.5 text-[0.95rem] font-medium">
        <TimeLink seconds={section.start} href={section.link} />
        <span dangerouslySetInnerHTML={{ __html: section.title_html }} />
      </h3>
      {hit.moments.length ? (
        hit.moments.map((m) => (
          <div key={m.start} className="my-1.5 grid grid-cols-1 sm:grid-cols-[4.2rem_1fr] sm:gap-2.5">
            <TimeLink seconds={m.start} href={m.link} className="sm:pt-1.5" />
            <p
              className="m-0 font-read text-[1.05rem] leading-[1.9] [&_.ctx]:text-muted"
              dangerouslySetInnerHTML={{
                __html: `<span class="ctx">${m.before}</span> ${m.html} <span class="ctx">${m.after}</span>`,
              }}
            />
          </div>
        ))
      ) : hit.snippet ? (
        <p
          className="m-0 font-read leading-[1.9] text-muted"
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      ) : null}
    </div>
  );
}
