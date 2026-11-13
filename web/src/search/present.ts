import type { Hit, Segment } from "../db/queries.js";
import { words } from "../normalize.js";

const MOMENTS_PER_RESULT = 3;
const FALLBACK_SNIPPET_CHARS = 300;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

// Semantic-only hits have no snippet and show the section start instead.
export function presentHit(h: Hit, segs: Segment[], snippet: string | undefined, terms: string[]) {
  const opening = segs.map((seg) => seg.text).join(" ").slice(0, FALLBACK_SNIPPET_CHARS);
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
    snippet:
      snippet !== undefined
        ? escapeHtml(snippet).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>")
        : opening
          ? `${escapeHtml(opening)}…`
          : "",
    moments: findMoments(segs, terms, h.url),
  };
}
