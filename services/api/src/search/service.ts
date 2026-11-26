import { semantic } from "../bootstrap.js";
import * as queries from "../db/queries.js";
import type { Hit, Scope, Segment } from "../db/queries.js";
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
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
}

// Each new query is embedded, so long ones are costly to serve.
const MAX_QUERY_CHARS = 200;

export class QueryError extends Error {}

function parse(params: SearchParams) {
  if (params.q.length > MAX_QUERY_CHARS) {
    throw new QueryError(`The query is longer than ${MAX_QUERY_CHARS} characters.`);
  }
  const parsed = parseQuery(params.q);
  if (!parsed) throw new QueryError("Type at least one word to search for.");
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const scope: Scope = {
    shows: [...new Set(params.shows ?? [])],
    startDate: day(params.startDate, "startDate"),
    endDate: day(params.endDate, "endDate"),
  };
  if (scope.startDate && scope.endDate && scope.startDate > scope.endDate) {
    throw new QueryError("startDate is after endDate.");
  }
  return { parsed, limit, page, scope };
}

function day(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  const real = !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !real) {
    throw new QueryError(`${name} must be a date as YYYY-MM-DD.`);
  }
  return value;
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
  const { parsed, limit, page, scope } = parse(params);
  const total = fts(() => queries.countMatchingEpisodes(parsed.match, scope));
  const episodeIds = fts(() => queries.bm25EpisodeIds(parsed.match, scope, limit, (page - 1) * limit));
  const hits = episodeIds.length ? fts(() => queries.bm25Hits(parsed.match, scope, episodeIds)) : [];
  return {
    mode: "keyword",
    query: parsed.match,
    total,
    page,
    limit,
    startDate: scope.startDate ?? null,
    endDate: scope.endDate ?? null,
    took_ms: Math.round(performance.now() - started),
    results: hydrate(groupByEpisode(hits).flat(), parsed),
  };
}

// Both rankings are filtered before taking their top RRF_DEPTH, so small
// channels and short ranges aren't crowded out.
async function hybridSearch(params: SearchParams, loaded: Semantic) {
  const started = performance.now();
  const { parsed, limit, page, scope } = parse(params);
  const bm25Ids = fts(() => queries.bm25SectionIds(parsed.match, scope, RRF_DEPTH));
  const semanticIds = await semanticSearch(loaded, params.q, RRF_DEPTH, {
    channels: scope.shows.length ? new Set(scope.shows) : undefined,
    startDate: scope.startDate,
    endDate: scope.endDate,
  });
  const byKeyword = new Set(bm25Ids);
  const bySemantic = new Set(semanticIds);

  const fused = rrf([bm25Ids, semanticIds]);
  const byId = new Map(queries.hitsByIds(fused.ids).map((h) => [h.id, h]));
  // A section deleted since the index last caught up has no hit.
  const found = fused.ids.filter((id) => byId.has(id));
  const groups = groupByEpisode(found.map((id) => ({ ...byId.get(id)!, score: fused.scores.get(id)! })));
  const hits = groups.slice((page - 1) * limit, page * limit).flat();

  return {
    mode: "hybrid",
    query: parsed.match,
    total: groups.length,
    page,
    limit,
    startDate: scope.startDate ?? null,
    endDate: scope.endDate ?? null,
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
  const segments = ids.length ? queries.segmentsBySection(ids) : new Map<number, Segment[]>();
  return hits.map((h) => presentHit(h, segments.get(h.id) ?? [], parsed.terms));
}
