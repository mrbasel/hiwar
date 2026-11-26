import type { Hit } from "../db/queries.js";

// Same as eval/methods.py.
const RRF_K = 60;
export const RRF_DEPTH = 50;
const SECTIONS_PER_EPISODE = 10;

export function rrf(rankings: number[][]): { ids: number[]; scores: Map<number, number> } {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  }
  const ids = [...scores.keys()].toSorted((a, b) => scores.get(b)! - scores.get(a)!);
  return { ids, scores };
}

export function groupByEpisode(hits: Hit[]): Hit[][] {
  const groups = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!groups.has(h.episode_id)) groups.set(h.episode_id, []);
    const group = groups.get(h.episode_id)!;
    if (group.length < SECTIONS_PER_EPISODE) group.push(h);
  }
  return [...groups.values()];
}
