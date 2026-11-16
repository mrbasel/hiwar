import { Link } from "@tanstack/react-router";
import { useRecommendations } from "#api/episodes";
import { EpisodeMeta } from "#components/episode/EpisodeMeta";
import { Thumbnail, videoId } from "#components/ui/Thumbnail";

const ROWS = 4;

export function RecommendedEpisodes({ episodeId }: { episodeId: string }) {
  const { data, isPending, error } = useRecommendations(episodeId);

  return (
    <section aria-labelledby="recommended">
      <h2 id="recommended" className="mb-3 text-sm font-semibold text-muted">
        حلقات مقترحة
      </h2>
      {error ? (
        <p className="text-sm text-faint">تعذّر تحميل الاقتراحات.</p>
      ) : isPending ? (
        <ol aria-busy className="space-y-4">
          {Array.from({ length: ROWS }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with nothing else to tell them apart
            <li key={i} className="flex gap-3">
              <div className="aspect-video w-28 shrink-0 animate-pulse rounded-control bg-sunken" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 animate-pulse rounded-mark bg-sunken" />
                <div className="h-4 w-4/5 animate-pulse rounded-mark bg-sunken" />
                <div className="h-3 w-2/3 animate-pulse rounded-mark bg-sunken" />
              </div>
            </li>
          ))}
        </ol>
      ) : data.length ? (
        <ol className="space-y-4">
          {data.map((e) => (
            <li key={e.id}>
              <Link
                to="/episode/$id"
                params={{ id: e.id }}
                className="group flex gap-3 text-ink no-underline"
              >
                <div className="w-28 shrink-0 overflow-hidden rounded-control">
                  <Thumbnail
                    videoId={videoId(e.url, e.id)}
                    alt=""
                    className="transition-opacity duration-150 group-hover:opacity-85"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    dir="auto"
                    className="line-clamp-2 text-sm leading-snug font-medium decoration-rule underline-offset-4 group-hover:underline"
                  >
                    {e.title}
                  </p>
                  <EpisodeMeta
                    show={e.show}
                    date={e.date}
                    duration={null}
                    className="mt-1 text-2xs text-muted"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-faint">لا توجد اقتراحات لهذه الحلقة بعد.</p>
      )}
    </section>
  );
}
