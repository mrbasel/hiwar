import { queryOptions, useQuery } from "@tanstack/react-query";
import { request } from "#api/client";
import { type EpisodeResponse, episodeKeys, type RecommendedEpisode } from "#api/episodes/episodes.types";

/** An episode and its whole transcript; episodes don't change once built. */
export const episodeQuery = (id: string) =>
  queryOptions({
    queryKey: episodeKeys.detail(id),
    queryFn: ({ signal }) => request<EpisodeResponse>(`/episodes/${encodeURIComponent(id)}`, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

export function useEpisode(id: string) {
  return useQuery(episodeQuery(id));
}

// TODO: the API has no recommendations yet. Until it does, these placeholders
// stand in for `GET /episodes/:id/recommendations`, after a short delay so
// the loading state shows.
const PLACEHOLDERS: RecommendedEpisode[] = [
  {
    id: "DOH_iH8T_c0",
    title: "أمريكا وإسرائيل: من يسيطر على الآخر؟ | بودكاست الشرق مع جوزيف مسعد",
    show: "Al Sharq Youth",
    date: "2025-12-26",
    duration: 5512,
    url: "https://www.youtube.com/watch?v=DOH_iH8T_c0",
  },
  {
    id: "pIYJjA3r9LM",
    title: "الصين وأمريكا وتشكل الاقتصاد العالمي | بودكاست الشرق مع طارق يوسف",
    show: "Al Sharq Youth",
    date: "2025-12-19",
    duration: 3880,
    url: "https://www.youtube.com/watch?v=pIYJjA3r9LM",
  },
  {
    id: "14rI0as_eKk",
    title: "لماذا تتسابق القوى الكبرى على القرن الإفريقي؟ | بودكاست الشرق",
    show: "Al Sharq Youth",
    date: "2025-11-28",
    duration: 6246,
    url: "https://www.youtube.com/watch?v=14rI0as_eKk",
  },
];

export function useRecommendations(id: string) {
  return useQuery({
    queryKey: episodeKeys.recommendations(id),
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      signal.throwIfAborted();
      return PLACEHOLDERS.filter((e) => e.id !== id);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
