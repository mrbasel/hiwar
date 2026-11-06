// Full-text search over sections (FTS5 + BM25), with the matching moments
// inside each section found from its timestamped segments.

import { DatabaseSync } from "node:sqlite";
import { words } from "./normalize.js";
import { parseQuery } from "./query.js";

// BM25 column weights: heading (episode + section title), transcript text.
const HEADING_WEIGHT = 3;
const TEXT_WEIGHT = 1;
const MOMENTS_PER_RESULT = 3;

export interface SearchParams {
  q: string;
  page?: number;
  limit?: number;
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

export function search(db: DatabaseSync, params: SearchParams) {
  const started = performance.now();
  const parsed = parseQuery(params.q);
  if (!parsed) throw new QueryError("Type at least one word to search for.");

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);

  const from = `
    FROM sections_fts
    JOIN sections s ON s.id = sections_fts.rowid
    JOIN episodes e ON e.id = s.episode_id
    WHERE sections_fts MATCH ?`;

  let total: number;
  let hits: Hit[];
  try {
    total = Number(db.prepare(`SELECT count(*) AS n ${from}`).get(parsed.match)!.n);
    hits = db
      .prepare(
        `SELECT s.id, s.idx, s.title, s.start_time, s.end_time,
                e.id AS episode_id, e.title AS episode_title, e.show, e.date, e.url, e.duration,
                bm25(sections_fts, ${HEADING_WEIGHT}, ${TEXT_WEIGHT}) AS score
         ${from}
         ORDER BY score
         LIMIT ? OFFSET ?`,
      )
      .all(parsed.match, limit, (page - 1) * limit) as unknown as Hit[];
  } catch (err) {
    throw new QueryError(`Search failed: ${(err as Error).message}`);
  }

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

  const results = hits.map((h) => ({
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
    snippet: snippets.get(h.id) ?? "",
    moments: findMoments(segments.get(h.id) ?? [], parsed.terms, h.url),
  }));

  return {
    query: parsed.match,
    total,
    page,
    limit,
    took_ms: Math.round(performance.now() - started),
    results,
  };
}
