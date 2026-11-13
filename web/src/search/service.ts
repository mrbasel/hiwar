import { semantic } from "../bootstrap.js";
import * as queries from "../db/queries.js";
import type { Hit, Segment } from "../db/queries.js";
import { presentHit } from "./present.js";
import { parseQuery, type ParsedQuery } from "./query.js";
import { groupByEpisode, RRF_DEPTH, rrf } from "./rank.js";
import { semanticSearch, type Semantic } from "./semantic.js";

export interface SearchParams {
  q: string;
  page?: number;
  limit?: number; // episodes per page
  mode?: "hybrid" | "keyword";
  shows?: string[]; // every channel if empty
}

export class QueryError extends Error {}

function parse(params: SearchParams) {
  const parsed = parseQuery(params.q);
  if (!parsed) throw new QueryError("Type at least one word to search for.");
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const shows = [...new Set(params.shows ?? [])];
  return { parsed, limit, page, shows };
}

function fts<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    throw new QueryError(`Search failed: ${(err as Error).message}`);
  }
}

export async function search(params: SearchParams) {
  if (!semantic || params.mode === "keyword") return bm25Search(params);
  try {
    return await hybridSearch(params, semantic);
  } catch (err) {
    if (err instanceof QueryError) throw err;
    console.error(`semantic search failed, falling back to keyword search: ${(err as Error).message}`);
    return bm25Search(params);
  }
}

// Pages by episode, so an episode's sections stay on one page.
function bm25Search(params: SearchParams) {
  const started = performance.now();
  const { parsed, limit, page, shows } = parse(params);
  const total = fts(() => queries.countMatchingEpisodes(parsed.match, shows));
  const episodeIds = fts(() => queries.bm25EpisodeIds(parsed.match, shows, limit, (page - 1) * limit));
  const hits = episodeIds.length ? fts(() => queries.bm25Hits(parsed.match, shows, episodeIds)) : [];
  return {
    mode: "keyword",
    query: parsed.match,
    total,
    page,
    limit,
    took_ms: Math.round(performance.now() - started),
    results: hydrate(groupByEpisode(hits).flat(), parsed),
  };
}

// Both rankings are limited to the chosen channels before taking their top
// RRF_DEPTH, so small channels aren't crowded out by the rest.
async function hybridSearch(params: SearchParams, semantic: Semantic) {
  const started = performance.now();
  const { parsed, limit, page, shows } = parse(params);
  const bm25Ids = fts(() => queries.bm25SectionIds(parsed.match, shows, RRF_DEPTH));
  const channels = shows.length ? new Set(shows) : undefined;
  const semanticIds = await semanticSearch(semantic.index, params.q, RRF_DEPTH, semantic.embed, channels);
  const byKeyword = new Set(bm25Ids);
  const bySemantic = new Set(semanticIds);

  const fused = rrf([bm25Ids, semanticIds]);
  const byId = new Map(queries.hitsByIds(fused.ids).map((h) => [h.id, h]));
  const groups = groupByEpisode(fused.ids.map((id) => ({ ...byId.get(id)!, score: fused.scores.get(id)! })));
  const hits = groups.slice((page - 1) * limit, page * limit).flat();

  return {
    mode: "hybrid",
    query: parsed.match,
    total: groups.length,
    page,
    limit,
    took_ms: Math.round(performance.now() - started),
    results: hydrate(hits, parsed).map((r) => ({
      ...r,
      matched_by: [
        ...(byKeyword.has(r.section.id) ? ["keyword"] : []),
        ...(bySemantic.has(r.section.id) ? ["semantic"] : []),
      ],
    })),
  };
}

function hydrate(hits: Hit[], parsed: ParsedQuery) {
  const ids = hits.map((h) => h.id);
  const snippets = ids.length ? queries.snippets(parsed.match, ids) : new Map<number, string>();
  const segments = ids.length ? queries.segmentsBySection(ids) : new Map<number, Segment[]>();
  return hits.map((h) => presentHit(h, segments.get(h.id) ?? [], snippets.get(h.id), parsed.terms));
}
