import { type SearchParams, useSearchResults } from "#api/search";
import { EpisodeResult } from "#components/EpisodeResult";
import { Pager } from "#components/Pager";
import { arabic, cn } from "#lib/format";

const NO_RESULTS = "لا توجد نتائج. جرّب كلمات أقل، أو تهجئة أخرى للاسم، أو استخدم * للبحث ببداية الكلمة.";

export function SearchResults({ params }: { params: SearchParams }) {
  const { data, error, isFetching, isPlaceholderData } = useSearchResults(params);
  const loading = isFetching && (!data || isPlaceholderData);

  return (
    <>
      <p aria-live="polite" className={cn("py-3 text-sm text-faint", error && "text-error")}>
        {error
          ? error.message
          : loading
            ? "جارٍ البحث…"
            : data &&
              (data.total
                ? `${arabic(data.total)} حلقة مطابقة في ${arabic(Math.round(data.took_ms / 100) / 10)} ثانية`
                : NO_RESULTS)}
      </p>
      {data && !error && (
        <>
          <div className="divide-y divide-rule">
            {data.episodes.map(({ episode, hits }) => (
              <EpisodeResult key={episode.id} episode={episode} hits={hits} />
            ))}
          </div>
          <Pager page={data.page} pages={data.pages} className="mt-10" />
        </>
      )}
    </>
  );
}
