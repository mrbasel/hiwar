import { db } from "./connection.js";

// BM25 weights: heading, transcript.
const HEADING_WEIGHT = 3;
const TEXT_WEIGHT = 1;
const BM25 = `bm25(sections_fts, ${HEADING_WEIGHT}, ${TEXT_WEIGHT})`;

export interface Hit {
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
  description: string | null;
  transcript_source: string | null;
  score: number;
}

export interface Segment {
  section_id: number;
  idx: number;
  start_time: number;
  end_time: number;
  text: string;
}

interface Snippet {
  id: number;
  snippet: string;
}

function placeholders(n: number): string {
  return Array(n).fill("?").join(", ");
}

const HIT_COLUMNS = `s.id, s.idx, s.title, s.start_time, s.end_time,
  e.id AS episode_id, e.title AS episode_title, e.show, e.date, e.url, e.duration,
  e.description, e.transcript_source`;

export interface Scope {
  shows: string[];
  startDate?: string;
  endDate?: string;
}

// Bind the match, then scopeArgs().
function ftsFrom(scope: Scope): string {
  const where = ["sections_fts MATCH ?"];
  if (scope.shows.length) where.push(`e.channel_id IN (${placeholders(scope.shows.length)})`);
  if (scope.startDate) where.push("e.date >= ?");
  if (scope.endDate) where.push("e.date <= ?");
  return `
    FROM sections_fts
    JOIN sections s ON s.id = sections_fts.rowid
    JOIN episodes e ON e.id = s.episode_id
    WHERE ${where.join(" AND ")}`;
}

function scopeArgs(scope: Scope): string[] {
  return [scope.shows, scope.startDate ?? [], scope.endDate ?? []].flat();
}

export function countMatchingEpisodes(match: string, scope: Scope): number {
  return Number(
    db.prepare(`SELECT count(DISTINCT s.episode_id) AS n ${ftsFrom(scope)}`).get(match, ...scopeArgs(scope))!.n,
  );
}

export function bm25EpisodeIds(
  match: string,
  scope: Scope,
  limit: number,
  offset: number,
): string[] {
  return db
    .prepare(
      // MATERIALIZED: bm25() can't run inside an aggregate.
      `WITH matches AS MATERIALIZED (SELECT s.episode_id, ${BM25} AS score ${ftsFrom(scope)})
       SELECT episode_id FROM matches
       GROUP BY episode_id ORDER BY min(score), episode_id
       LIMIT ? OFFSET ?`,
    )
    .all(match, ...scopeArgs(scope), limit, offset)
    .map((r) => String(r.episode_id));
}

export function bm25Hits(match: string, scope: Scope, episodeIds: string[]): Hit[] {
  return db
    .prepare(
      `SELECT ${HIT_COLUMNS}, ${BM25} AS score ${ftsFrom(scope)}
       AND s.episode_id IN (${placeholders(episodeIds.length)})
       ORDER BY score`,
    )
    .all(match, ...scopeArgs(scope), ...episodeIds) as unknown as Hit[];
}

export function bm25SectionIds(match: string, scope: Scope, limit: number): number[] {
  return db
    .prepare(
      `SELECT s.id ${ftsFrom(scope)}
       ORDER BY ${BM25}
       LIMIT ?`,
    )
    .all(match, ...scopeArgs(scope), limit)
    .map((r) => Number(r.id));
}

export function hitsByIds(ids: number[]): Hit[] {
  if (!ids.length) return [];
  return db
    .prepare(
      `SELECT ${HIT_COLUMNS}, 0 AS score FROM sections s JOIN episodes e ON e.id = s.episode_id
       WHERE s.id IN (${placeholders(ids.length)})`,
    )
    .all(...ids) as unknown as Hit[];
}

// Matching words are between \x02 and \x03. Only for a page, so snippet()
// doesn't run on every match.
export function snippets(match: string, ids: number[]): Map<number, string> {
  const rows = db
    .prepare(
      `SELECT rowid AS id, snippet(sections_fts, 1, char(2), char(3), '…', 24) AS snippet
       FROM sections_fts WHERE sections_fts MATCH ? AND rowid IN (${placeholders(ids.length)})`,
    )
    .all(match, ...ids) as unknown as Snippet[];
  return new Map(rows.map((r) => [r.id, r.snippet]));
}

export function segmentsBySection(ids: number[]): Map<number, Segment[]> {
  const segs = db
    .prepare(
      `SELECT section_id, idx, start_time, end_time, text
       FROM segments WHERE section_id IN (${placeholders(ids.length)}) ORDER BY section_id, idx`,
    )
    .all(...ids) as unknown as Segment[];
  const bySection = new Map<number, Segment[]>();
  for (const seg of segs) {
    if (!bySection.has(seg.section_id)) bySection.set(seg.section_id, []);
    bySection.get(seg.section_id)!.push(seg);
  }
  return bySection;
}

export function listShows() {
  return db
    .prepare(
      `SELECT c.id, trim(c.name) AS name, count(*) AS episodes
       FROM episodes e JOIN channels c ON c.id = e.channel_id
       GROUP BY c.id ORDER BY episodes DESC, name`,
    )
    .all();
}

export interface EpisodeRow {
  id: string;
  title: string | null;
  show: string;
  date: string;
  duration: number | null;
  url: string;
  description: string | null;
  transcript_source: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_url: string | null;
}

export interface SectionRow {
  id: number;
  idx: number;
  title: string | null;
  start_time: number;
  end_time: number;
}

export interface UtteranceRow extends Segment {
  speaker_change: number | null;
}

export function episodeById(id: string): EpisodeRow | undefined {
  return db
    .prepare(
      `SELECT e.id, e.title, e.show, e.date, e.duration, e.url, e.description, e.transcript_source,
         c.id AS channel_id, trim(c.name) AS channel_name, c.url AS channel_url
       FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id
       WHERE e.id = ?`,
    )
    .get(id) as unknown as EpisodeRow | undefined;
}

export interface EpisodeSummary {
  id: string;
  title: string | null;
  show: string;
  date: string;
  duration: number | null;
  url: string;
}

export function episodesByIds(ids: string[]): EpisodeSummary[] {
  if (!ids.length) return [];
  return db
    .prepare(
      `SELECT id, title, show, date, duration, url FROM episodes WHERE id IN (${placeholders(ids.length)})`,
    )
    .all(...ids) as unknown as EpisodeSummary[];
}

export function sectionsOfEpisode(id: string): SectionRow[] {
  return db
    .prepare(`SELECT id, idx, title, start_time, end_time FROM sections WHERE episode_id = ? ORDER BY idx`)
    .all(id) as unknown as SectionRow[];
}

export function segmentsOfEpisode(id: string): UtteranceRow[] {
  return db
    .prepare(
      `SELECT section_id, idx, start_time, end_time, text, speaker_change
       FROM segments WHERE episode_id = ? ORDER BY idx`,
    )
    .all(id) as unknown as UtteranceRow[];
}
