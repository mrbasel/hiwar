import { useQuery } from "@tanstack/react-query";
import { request } from "#api/client";
import { type MapData, mapKeys } from "#api/map/map.types";

/** The episode map from `pipeline.map`; 404s until it has been built. */
export function useEpisodeMap() {
  return useQuery({
    queryKey: mapKeys.all,
    queryFn: ({ signal }) => request<MapData>("/map", { signal }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
