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

export function useRecommendations(id: string) {
  return useQuery({
    queryKey: episodeKeys.recommendations(id),
    queryFn: ({ signal }) =>
      request<RecommendedEpisode[]>(`/episodes/${encodeURIComponent(id)}/recommendations`, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
