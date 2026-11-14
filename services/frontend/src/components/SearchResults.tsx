import { type SearchParams, useSearchResults } from "#api/search";
import { EpisodeCard } from "#components/EpisodeCard";
import { Pager } from "#components/Pager";
import { arabic, cn } from "#lib/format";

const NO_RESULTS = "لا توجد نتائج. جرّب كلمات أقل، أو تهجئة أخرى للاسم، أو استخدم * للبحث ببداية الكلمة.";

// The status line, the episodes on this page, and the pager. While the next
// page or search loads, the previous one stays on screen.
export function SearchResults({ params }: { params: SearchParams }) {
  const { data, error, isFetching, isPlaceholderData } = useSearchResults(params);
  const loading = isFetching && (!data || isPlaceholderData);

  return (
    <>
      <p aria-live="polite" className={cn("mt-1 mb-4 text-sm text-muted", error && "text-error")}>
        {error
          ? error.message
          : loading
            ? "جارٍ البحث…"
            : data && (data.total ? `${arabic(data.total)} حلقة مطابقة (${data.took_ms} ms)` : NO_RESULTS)}
      </p>
      {data && !error && (
        <>
          {data.episodes.map(({ episode, hits }) => (
            <EpisodeCard key={episode.id} episode={episode} hits={hits} />
          ))}
          <Pager page={data.page} pages={data.pages} />
        </>
      )}
    </>
  );
}
