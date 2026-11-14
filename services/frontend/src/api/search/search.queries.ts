import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "#api/client";
import {
  type EpisodeResult,
  type ResultsPage,
  type SearchParams,
  type SearchResponse,
  searchKeys,
} from "#api/search/search.types";

export function useSearchResults(params: SearchParams) {
  return useQuery({
    queryKey: searchKeys.results(params),
    queryFn: ({ signal }) => {
      const url = new URLSearchParams({ q: params.q });
      if (params.page > 1) url.set("page", String(params.page));
      if (params.mode === "keyword") url.set("mode", "keyword");
      if (params.shows.length) url.set("shows", params.shows.join(","));
      return request<SearchResponse>(`/search?${url}`, { signal });
    },
    select: toResultsPage,
    enabled: params.q !== "",
    // Keep the old page on screen while the next one loads.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

// Pages are counted in episodes; an episode's sections all land on one page,
// in the order of its best hit.
function toResultsPage({ results, ...rest }: SearchResponse): ResultsPage {
  const episodes = new Map<string, EpisodeResult>();
  for (const hit of results) {
    const group = episodes.get(hit.episode.id) ?? { episode: hit.episode, hits: [] };
    group.hits.push(hit);
    episodes.set(hit.episode.id, group);
  }
  return { ...rest, pages: Math.ceil(rest.total / rest.limit), episodes: [...episodes.values()] };
}
