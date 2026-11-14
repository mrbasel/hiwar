import { useQuery } from "@tanstack/react-query";
import { request } from "#api/client";
import { type Show, type ShowsResponseItem, showKeys } from "#api/shows/shows.types";

/** The channels, biggest first, for the picker. */
export function useShows() {
  return useQuery({
    queryKey: showKeys.all,
    queryFn: async ({ signal }) => {
      const shows = await request<ShowsResponseItem[]>("/shows", { signal });
      return shows.map((s): Show => ({ ...s, id: String(s.id) }));
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
