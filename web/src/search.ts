// Search over sections: full-text (FTS5 + BM25), or hybrid with semantic
// search fused by reciprocal rank fusion. The matching moments inside each
// section are found from its timestamped segments.

import { DatabaseSync } from "node:sqlite";
import { words } from "./normalize.js";
import { parseQuery, type ParsedQuery } from "./query.js";
import { semanticSearch, type Index } from "./semantic.js";

// BM25 column weights: heading (episode + section title), transcript text.
const HEADING_WEIGHT = 3;
const TEXT_WEIGHT = 1;
const MOMENTS_PER_RESULT = 3;
// Same as eval/methods.py, so the eval scores what the site serves.
const RRF_K = 60;
const RRF_DEPTH = 50;
const FALLBACK_SNIPPET_CHARS = 300;
const SECTIONS_PER_EPISODE = 10;

export interface SearchParams {
  q: string;
  page?: number;
  limit?: number; // episodes per page
  mode?: "hybrid" | "keyword"; // keyword: full-text search only
}

export interface Semantic {
  index: Index;
  key: string;
}

interface Hit {
  id: number;
  idx: number;
  title: string | null;
  start_time: number;
  end_time: number;
  episode_id: string;
  episode_title: string | null;
  show: string;
  date: string;
  url: string;
  duration: number | null;
  score: number;
}

interface Snippet {
  id: number;
  snippet: string;
}

interface Segment {
  section_id: number;
  idx: number;
  start_time: number;
  end_time: number;
  text: string;
}

export class QueryError extends Error {}

export function openDb(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// HTML-escaped text with words matching any term wrapped in <mark>.
export function highlight(text: string, terms: string[]): string {
  const set = new Set(terms);
  return text
    .split(/([\p{L}\p{N}\p{M}]+)/u)
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const hit = set.has(words(part)[0] ?? "");
      return hit ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part);
    })
    .join("");
}

function link(url: string, seconds: number): string {
  return `${url}&t=${Math.floor(seconds)}s`;
}

// Segments that contain the most distinct query terms, in time order, with
// the utterances around them as context.
function findMoments(segments: Segment[], terms: string[], url: string) {
  const scored = segments
    .map((seg, i) => {
      const ws = new Set(words(seg.text));
      return { i, score: terms.filter((t) => ws.has(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const picked: number[] = [];
  for (const { i } of scored) {
    if (picked.length === MOMENTS_PER_RESULT) break;
    if (picked.every((p) => Math.abs(p - i) > 2)) picked.push(i);
  }
  return picked
    .sort((a, b) => a - b)
    .map((i) => {
      const seg = segments[i];
      return {
        start: seg.start_time,
        link: link(url, seg.start_time),
        before: escapeHtml(segments[i - 1]?.text ?? ""),
        html: highlight(seg.text, terms),
        after: escapeHtml(segments[i + 1]?.text ?? ""),
      };
    });
}

function placeholders(n: number): string {
  return Array(n).fill("?").join(", ");
}

const HIT_COLUMNS = `s.id, s.idx, s.title, s.start_time, s.end_time,
  e.id AS episode_id, e.title AS episode_title, e.show, e.date, e.url, e.duration`;

const FTS_FROM = `
    FROM sections_fts
    JOIN sections s ON s.id = sections_fts.rowid
    JOIN episodes e ON e.id = s.episode_id
    WHERE sections_fts MATCH ?`;

function parse(params: SearchParams) {
  const parsed = parseQuery(params.q);
  if (!parsed) throw new QueryError("Type at least one word to search for.");
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  return { parsed, limit, page };
}

function fts<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    throw new QueryError(`Search failed: ${(err as Error).message}`);
  }
}

export async function search(db: DatabaseSync, params: SearchParams, semantic?: Semantic) {
  if (!semantic || params.mode === "keyword") return bm25Search(db, params);
  try {
    return await hybridSearch(db, params, semantic);
  } catch (err) {
    if (err instanceof QueryError) throw err;
    console.error(`semantic search failed, falling back to keyword search: ${(err as Error).message}`);
    return bm25Search(db, params);
  }
}

// Hits grouped by episode, episodes in order of their best hit, keeping at
// most SECTIONS_PER_EPISODE hits of each. `hits` must be sorted best first.
function groupByEpisode(hits: Hit[]): Hit[][] {
  const groups = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!groups.has(h.episode_id)) groups.set(h.episode_id, []);
    const group = groups.get(h.episode_id)!;
    if (group.length < SECTIONS_PER_EPISODE) group.push(h);
  }
  return [...groups.values()];
}

// Pages are pages of episodes (`limit` episodes each), so an episode shows up
// on one page with all its matching sections, not split across pages.
function bm25Search(db: DatabaseSync, params: SearchParams) {
  const started = performance.now();
  const { parsed, limit, page } = parse(params);
  const score = `bm25(sections_fts, ${HEADING_WEIGHT}, ${TEXT_WEIGHT})`;
  const total = fts(() =>
    Number(db.prepare(`SELECT count(DISTINCT s.episode_id) AS n ${FTS_FROM}`).get(parsed.match)!.n),
  );
  const episodeIds = fts(() =>
    db
      .prepare(
        // MATERIALIZED stops SQLite from merging the two queries: bm25() can't
        // run inside an aggregate.
        `WITH matches AS MATERIALIZED (SELECT s.episode_id, ${score} AS score ${FTS_FROM})
         SELECT episode_id FROM matches
         GROUP BY episode_id ORDER BY min(score), episode_id
         LIMIT ? OFFSET ?`,
      )
      .all(parsed.match, limit, (page - 1) * limit)
      .map((r) => String(r.episode_id)),
  );
  const hits = episodeIds.length
    ? fts(
        () =>
          db
            .prepare(
              `SELECT ${HIT_COLUMNS}, ${score} AS score ${FTS_FROM}
               AND s.episode_id IN (${placeholders(episodeIds.length)})
               ORDER BY score`,
            )
            .all(parsed.match, ...episodeIds) as unknown as Hit[],
      )
    : [];
  return {
    mode: "keyword",
    query: parsed.match,
    total,
    page,
    limit,
    took_ms: Math.round(performance.now() - started),
    results: hydrate(db, groupByEpisode(hits).flat(), parsed),
  };
}

// BM25 and semantic search, RRF_DEPTH sections each, fused with RRF: every
// section scores the sum of 1 / (RRF_K + rank) over the rankings it's in.
// Paged by episode, like bm25Search.
async function hybridSearch(db: DatabaseSync, params: SearchParams, semantic: Semantic) {
  const started = performance.now();
  const { parsed, limit, page } = parse(params);
  const bm25Ids = fts(
    () =>
      db
        .prepare(
          `SELECT s.id ${FTS_FROM}
           ORDER BY bm25(sections_fts, ${HEADING_WEIGHT}, ${TEXT_WEIGHT})
           LIMIT ?`,
        )
        .all(parsed.match, RRF_DEPTH)
        .map((r) => Number(r.id)),
  );
  const semanticIds = await semanticSearch(db, semantic.index, params.q, RRF_DEPTH, semantic.key);
  const byKeyword = new Set(bm25Ids);
  const bySemantic = new Set(semanticIds);

  const scores = new Map<number, number>();
  for (const ranking of [bm25Ids, semanticIds]) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  }
  const fused = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!);

  const rows = fused.length
    ? (db
        .prepare(
          `SELECT ${HIT_COLUMNS}, 0 AS score FROM sections s JOIN episodes e ON e.id = s.episode_id
           WHERE s.id IN (${placeholders(fused.length)})`,
        )
        .all(...fused) as unknown as Hit[])
    : [];
  const byId = new Map(rows.map((h) => [h.id, h]));
  const episodes = groupByEpisode(fused.map((id) => ({ ...byId.get(id)!, score: scores.get(id)! })));
  const hits = episodes.slice((page - 1) * limit, page * limit).flat();

  return {
    mode: "hybrid",
    query: parsed.match,
    total: episodes.length,
    page,
    limit,
    took_ms: Math.round(performance.now() - started),
    results: hydrate(db, hits, parsed).map((r) => ({
      ...r,
      // which rankings found the section: "keyword" (BM25), "semantic" or both
      matched_by: [
        ...(byKeyword.has(r.section.id) ? ["keyword"] : []),
        ...(bySemantic.has(r.section.id) ? ["semantic"] : []),
      ],
    })),
  };
}

// Snippets, moments and links for one page of hits. Sections that don't
// contain every query word (found by semantic search only) have no FTS
// snippet; they show the start of the section instead.
function hydrate(db: DatabaseSync, hits: Hit[], parsed: ParsedQuery) {
  const ids = hits.map((h) => h.id);
  const snippets = new Map<number, string>();
  const segments = new Map<number, Segment[]>();
  if (ids.length) {
    // Snippets only for this page; computing them in the ranked query would
    // run snippet() over every match before the LIMIT.
    const rows = db
      .prepare(
        `SELECT rowid AS id, snippet(sections_fts, 1, char(2), char(3), '…', 24) AS snippet
         FROM sections_fts WHERE sections_fts MATCH ? AND rowid IN (${placeholders(ids.length)})`,
      )
      .all(parsed.match, ...ids) as unknown as Snippet[];
    for (const r of rows) {
      snippets.set(
        r.id,
        escapeHtml(r.snippet).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>"),
      );
    }
    const segs = db
      .prepare(
        `SELECT section_id, idx, start_time, end_time, text
         FROM segments WHERE section_id IN (${placeholders(ids.length)}) ORDER BY section_id, idx`,
      )
      .all(...ids) as unknown as Segment[];
    for (const seg of segs) {
      if (!segments.has(seg.section_id)) segments.set(seg.section_id, []);
      segments.get(seg.section_id)!.push(seg);
    }
  }

  return hits.map((h) => {
    const segs = segments.get(h.id) ?? [];
    const opening = segs.map((seg) => seg.text).join(" ").slice(0, FALLBACK_SNIPPET_CHARS);
    return {
      section: {
        id: h.id,
        idx: h.idx,
        title: h.title,
        title_html: highlight(h.title ?? "", parsed.terms),
        start: h.start_time,
        end: h.end_time,
        link: link(h.url, h.start_time),
      },
      episode: {
        id: h.episode_id,
        title: h.episode_title,
        title_html: highlight(h.episode_title ?? "", parsed.terms),
        show: h.show,
        date: h.date,
        url: h.url,
        duration: h.duration,
      },
      score: h.score,
      snippet: snippets.get(h.id) ?? (opening ? `${escapeHtml(opening)}…` : ""),
      moments: findMoments(segs, parsed.terms, h.url),
    };
  });
}
