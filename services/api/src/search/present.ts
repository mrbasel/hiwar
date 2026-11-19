import type { Hit, Segment } from "../db/queries.js";
import { link } from "../links.js";
import { words } from "../normalize.js";

const MOMENTS_PER_RESULT = 3;
const SNIPPET_WORDS = 24;
const FALLBACK_SNIPPET_CHARS = 300;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Words at odd indexes, what's between them at even ones.
function splitWords(text: string): string[] {
  return text.split(/([\p{L}\p{N}\p{M}]+)/u);
}

export function highlight(text: string, terms: string[]): string {
  const set = new Set(terms);
  return splitWords(text)
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const hit = set.has(words(part)[0] ?? "");
      return hit ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part);
    })
    .join("");
}

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

// The SNIPPET_WORDS words of the text with the most distinct terms in them,
// highlighted, like FTS5's snippet(); undefined if no term is in the text.
export function snippet(text: string, terms: string[]): string | undefined {
  const parts = splitWords(text);
  const termOf = (n: number) => terms.indexOf(words(parts[2 * n + 1])[0] ?? "");
  const found = Array.from({ length: (parts.length - 1) / 2 }, (_, n) => termOf(n));
  let best = -1, bestCount = 0;
  for (let start = 0; start < found.length; start++) {
    if (found[start] < 0) continue; // windows start at a term
    const count = new Set(found.slice(start, start + SNIPPET_WORDS).filter((t) => t >= 0)).size;
    if (count > bestCount) [best, bestCount] = [start, count];
  }
  if (best < 0) return undefined;
  // Start a few words early, so the first term has some context.
  const first = Math.max(0, Math.min(best - 4, found.length - SNIPPET_WORDS));
  const last = Math.min(found.length, first + SNIPPET_WORDS);
  const html = highlight(parts.slice(2 * first + 1, 2 * last).join(""), terms);
  return `${first > 0 ? "…" : ""}${html}${last < found.length ? "…" : ""}`;
}

// Hits without query words in their text show the section start instead.
export function presentHit(h: Hit, segs: Segment[], terms: string[]) {
  const text = segs.map((seg) => seg.text).join(" ");
  const opening = text.slice(0, FALLBACK_SNIPPET_CHARS);
  return {
    section: {
      id: h.id,
      idx: h.idx,
      title: h.title,
      title_html: highlight(h.title ?? "", terms),
      start: h.start_time,
      end: h.end_time,
      link: link(h.url, h.start_time),
    },
    episode: {
      id: h.episode_id,
      title: h.episode_title,
      title_html: highlight(h.episode_title ?? "", terms),
      show: h.show,
      date: h.date,
      url: h.url,
      duration: h.duration,
      has_transcript: h.transcript_source !== null,
      // one line break between paragraphs keeps long descriptions compact
      description_html: highlight((h.description ?? "").replace(/\s*\n\s*/g, "\n").trim(), terms),
    },
    score: h.score,
    snippet: snippet(text, terms) ?? (opening ? `${escapeHtml(opening)}…` : ""),
    moments: findMoments(segs, terms, h.url),
  };
}
