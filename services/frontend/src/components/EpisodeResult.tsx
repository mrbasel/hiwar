import { Collapsible } from "@base-ui/react/collapsible";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Episode, Moment, SearchHit } from "#api/search";
import { EpisodeMeta } from "#components/episode/EpisodeMeta";
import { buttonClass } from "#components/ui/Button";
import { Tag } from "#components/ui/Tag";
import { Thumbnail, videoId } from "#components/ui/Thumbnail";
import { Timestamp } from "#components/ui/Timestamp";
import { useDevMode } from "#lib/devMode";
import { arabic, cn } from "#lib/format";

const MATCH_LABEL = { keyword: "تطابق لفظي", semantic: "تطابق في المعنى" } as const;

const toggleClass = cn(buttonClass("quiet", "sm"), "-ms-3 text-muted hover:text-ink");

const quoteClass = "font-read text-[1.1rem] leading-[1.6] sm:text-[1.3rem]";

const momentHtml = (m: Moment) =>
  `<span class="ctx">${m.before}</span> ${m.html} <span class="ctx">${m.after}</span>`;

export function EpisodeResult({ episode, hits }: { episode: Episode; hits: SearchHit[] }) {
  const [devMode] = useDevMode();
  const via = new Set(hits.flatMap((h) => h.matched_by ?? []));
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(!episode.has_transcript);
  const moment = hits.find((h) => h.moments.length)?.moments[0];
  const snippet = hits.find((h) => h.snippet)?.snippet;

  return (
    <article className="py-5">
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <EpisodeMeta
            show={episode.show}
            date={episode.date}
            duration={episode.duration}
            hideDurationOnMobile
          />
          <h2 className="line-clamp-2 text-lg leading-snug font-semibold sm:line-clamp-none">
            <Link
              to="/episode/$id"
              params={{ id: episode.id }}
              className="text-ink no-underline decoration-rule underline-offset-4 hover:underline"
              dangerouslySetInnerHTML={{ __html: episode.title_html }}
            />
          </h2>

          {!sectionsOpen && episode.has_transcript && (moment || snippet) && (
            <p className={cn("mt-1.5 line-clamp-2", quoteClass)}>
              {moment ? (
                <>
                  <InlineTime seconds={moment.start} href={moment.link} />
                  <span
                    className="[&_.ctx]:text-muted"
                    dangerouslySetInnerHTML={{ __html: momentHtml(moment) }}
                  />
                </>
              ) : (
                <span className="text-muted" dangerouslySetInnerHTML={{ __html: snippet ?? "" }} />
              )}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(["keyword", "semantic"] as const)
              .filter((m) => devMode && via.has(m))
              .map((m) => (
                <Tag key={m} tone={m === "semantic" ? "accent" : "plain"}>
                  {MATCH_LABEL[m]}
                </Tag>
              ))}
            {devMode && !episode.has_transcript && <Tag tone="warn">بدون نص</Tag>}
          </div>
        </div>

        {/* Out of the tab order: the title already links to the episode. */}
        <Link
          to="/episode/$id"
          params={{ id: episode.id }}
          tabIndex={-1}
          className="mt-1 block w-24 shrink-0 overflow-hidden rounded-control sm:w-40"
        >
          <Thumbnail
            videoId={videoId(episode.url, episode.id)}
            alt={episode.title ?? "الحلقة"}
            className="transition-opacity duration-150 hover:opacity-85"
          />
        </Link>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4">
        {episode.has_transcript && (
          <Collapsible.Root open={sectionsOpen} onOpenChange={setSectionsOpen} className="contents">
            <Collapsible.Trigger className={toggleClass}>
              {sectionsOpen ? "أخفِ الأجزاء" : `الأجزاء المطابقة (${arabic(hits.length)})`}
              <ChevronDown
                className={cn("transition-transform duration-150", sectionsOpen && "rotate-180")}
              />
            </Collapsible.Trigger>
            <Collapsible.Panel className="order-last mt-2 basis-full space-y-4 border-s-2 border-rule ps-4">
              {hits.map((hit) => (
                <Section key={hit.section.id} episodeId={episode.id} hit={hit} />
              ))}
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
        {devMode && episode.description_html && (
          <Collapsible.Root open={descOpen} onOpenChange={setDescOpen} className="contents">
            <Collapsible.Trigger className={toggleClass}>
              {descOpen ? "أخفِ الوصف" : "اعرض الوصف"}
            </Collapsible.Trigger>
            <Collapsible.Panel
              className="order-last mt-1 max-h-60 basis-full overflow-y-auto text-sm leading-relaxed wrap-anywhere whitespace-pre-line text-muted"
              dangerouslySetInnerHTML={{ __html: episode.description_html }}
            />
          </Collapsible.Root>
        )}
      </div>
    </article>
  );
}

function InlineTime({ seconds, href, className }: { seconds: number; href: string; className?: string }) {
  return (
    <span className="me-3 inline-block align-[0.15em]">
      <Timestamp seconds={seconds} href={href} className={cn("font-ui text-xs", className)} />
    </span>
  );
}

function Section({ episodeId, hit }: { episodeId: string; hit: SearchHit }) {
  const { section } = hit;
  return (
    <section>
      <h3 className="flex items-baseline gap-2 text-base font-medium">
        <Timestamp seconds={section.start} href={section.link} />
        <Link
          to="/episode/$id"
          params={{ id: episodeId }}
          search={{ tab: "transcript" }}
          hash={`section-${section.idx}`}
          className="text-ink no-underline decoration-rule underline-offset-4 hover:underline"
          dangerouslySetInnerHTML={{ __html: section.title_html }}
        />
      </h3>
      {hit.moments.map((m) => (
        <p key={m.start} className={cn("mt-1", quoteClass)}>
          <InlineTime seconds={m.start} href={m.link} className="text-faint" />
          <span className="[&_.ctx]:text-muted" dangerouslySetInnerHTML={{ __html: momentHtml(m) }} />
        </p>
      ))}
      {!hit.moments.length && hit.snippet && (
        <p className={cn("mt-1 text-muted", quoteClass)} dangerouslySetInnerHTML={{ __html: hit.snippet }} />
      )}
    </section>
  );
}
