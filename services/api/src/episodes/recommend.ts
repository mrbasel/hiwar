import { semantic } from "../bootstrap.js";
import { episodesByIds } from "../db/queries.js";
import { best, dotProducts, type Index } from "../search/semantic.js";

const COUNT = 8;
const PER_CHANNEL = 3;
const CACHED = 1000;

const cache = new Map<string, string[]>();

export function recommendations(id: string) {
  if (!semantic) return [];
  let ids = cache.get(id);
  if (!ids) {
    ids = similarEpisodes(semantic.index, id, COUNT);
    cache.set(id, ids);
    if (cache.size > CACHED) cache.delete(cache.keys().next().value!);
  }
  const byId = new Map(episodesByIds(ids).map((e) => [e.id, e]));
  return ids.flatMap((i) => byId.get(i) ?? []);
}

function similarEpisodes(index: Index, id: string, k: number): string[] {
  const doc = index.episodeDoc.get(id);
  if (doc === undefined) return [];
  const { vectors, dims, chapterDocs, episodes, channels } = index;
  const q = vectors.subarray(doc * dims, (doc + 1) * dims);
  const scores = dotProducts(vectors, dims, chapterDocs, q);

  // Widen until the top chapters cover k episodes.
  for (let m = k * 16; ; m *= 4) {
    const top = best(scores, m);
    const ids: string[] = [];
    const seen = new Set([id]);
    const perChannel = new Map<string, number>();
    for (const n of top) {
      const chapter = chapterDocs[n];
      const episode = episodes[chapter];
      if (seen.has(episode)) continue;
      seen.add(episode);
      const shown = perChannel.get(channels[chapter]) ?? 0;
      if (shown === PER_CHANNEL) continue;
      perChannel.set(channels[chapter], shown + 1);
      ids.push(episode);
      if (ids.length === k) return ids;
    }
    if (top.length === chapterDocs.length) return ids;
  }
}
